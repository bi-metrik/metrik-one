'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function getStaff() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()
  if (!profile) return []

  const { data } = await supabase
    .from('staff')
    .select('*')
    .eq('workspace_id', profile.workspace_id)
    .order('full_name')

  return data || []
}

export async function createStaffMember(formData: {
  full_name: string
  position?: string
  department?: string
  contract_type?: string
  salary?: number
  phone_whatsapp?: string
  horas_disponibles_mes?: number
  tipo_vinculo?: string
  rol_plataforma?: string
  area?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()
  if (!profile) return { error: 'Sin perfil' }

  // Solo owner/admin puede gestionar personal
  if (!['owner', 'admin'].includes(profile.role)) {
    return { error: 'Sin permisos para gestionar personal' }
  }

  const { error } = await supabase.from('staff').insert({
    workspace_id: profile.workspace_id,
    full_name: formData.full_name,
    position: formData.position || null,
    department: formData.department || null,
    contract_type: formData.contract_type || 'fijo',
    salary: formData.salary || 0,
    phone_whatsapp: formData.phone_whatsapp || null,
    horas_disponibles_mes: formData.horas_disponibles_mes ?? 160,
    tipo_vinculo: formData.tipo_vinculo || null,
    rol_plataforma: formData.rol_plataforma || 'ejecutor',
    area: formData.area || null,
  })

  if (error) return { error: error.message }
  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  return { success: true }
}

export async function updateStaffMember(
  id: string,
  formData: {
    full_name?: string
    position?: string | null
    department?: string | null
    contract_type?: string
    salary?: number
    phone_whatsapp?: string | null
    is_active?: boolean
    horas_disponibles_mes?: number
    tipo_vinculo?: string | null
    rol_plataforma?: string
    area?: string | null
  }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()
  if (!profile) return { error: 'Sin perfil' }

  if (!['owner', 'admin'].includes(profile.role)) {
    return { error: 'Sin permisos para gestionar personal' }
  }

  const { error } = await supabase
    .from('staff')
    .update(formData)
    .eq('id', id)
    .eq('workspace_id', profile.workspace_id)

  if (error) return { error: error.message }
  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  return { success: true }
}

export async function deleteStaffMember(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()
  if (!profile) return { error: 'Sin perfil' }

  if (!['owner', 'admin'].includes(profile.role)) {
    return { error: 'Sin permisos para gestionar personal' }
  }

  const { error } = await supabase
    .from('staff')
    .delete()
    .eq('id', id)
    .eq('workspace_id', profile.workspace_id)

  if (error) return { error: error.message }
  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  return { success: true }
}

/** Get license usage: used seats vs max_seats */
export async function getLicenseInfo() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { used: 0, max: 1 }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()
  if (!profile) return { used: 0, max: 1 }

  const [{ count }, { data: ws }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', profile.workspace_id),
    supabase
      .from('workspaces')
      .select('max_seats')
      .eq('id', profile.workspace_id)
      .single(),
  ])

  return {
    used: count ?? 0,
    max: ws?.max_seats ?? 1,
  }
}

/** Invite a staff member to the platform (create profile + send magic link) */
export async function inviteStaffToPlataform(staffId: string, email: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()
  if (!profile) return { error: 'Sin perfil' }

  if (profile.role !== 'owner') {
    return { error: 'Solo el empresario puede invitar a la plataforma' }
  }

  // Validate staff belongs to this workspace and has no profile_id
  const { data: staffMember } = await supabase
    .from('staff')
    .select('id, full_name, profile_id, rol_plataforma, workspace_id')
    .eq('id', staffId)
    .eq('workspace_id', profile.workspace_id)
    .single()

  if (!staffMember) return { error: 'Miembro no encontrado' }
  if (staffMember.profile_id) return { error: 'Este miembro ya tiene acceso a la plataforma' }

  // Check seat availability
  const { used, max } = await getLicenseInfo()
  if (used >= max) {
    return { error: `Sin licencias disponibles (${used}/${max}). Contacta soporte para ampliar tu plan.` }
  }

  // Map staff rol_plataforma to profiles.role
  const roleMap: Record<string, string> = {
    dueno: 'owner',
    administrador: 'admin',
    supervisor: 'supervisor',
    ejecutor: 'operator',
    campo: 'read_only',
  }
  const inviteRole = roleMap[staffMember.rol_plataforma || 'ejecutor'] || 'operator'

  // Check if invitation already pending
  const normalizedEmail = email.trim().toLowerCase()
  const { data: existing } = await supabase
    .from('team_invitations')
    .select('id, status')
    .eq('workspace_id', profile.workspace_id)
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (existing?.status === 'pending') {
    return { error: 'Ya existe una invitacion pendiente para este email' }
  }

  // Upsert invitation
  if (existing) {
    await supabase
      .from('team_invitations')
      .update({
        role: inviteRole,
        status: 'pending',
        invited_by: user.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq('id', existing.id)
  } else {
    const { error: insertError } = await supabase
      .from('team_invitations')
      .insert({
        workspace_id: profile.workspace_id,
        email: normalizedEmail,
        role: inviteRole,
        invited_by: user.id,
      })
    if (insertError) return { error: insertError.message }
  }

  // Get the invitation token
  const { data: inv } = await supabase
    .from('team_invitations')
    .select('token')
    .eq('workspace_id', profile.workspace_id)
    .eq('email', normalizedEmail)
    .eq('status', 'pending')
    .single()

  if (!inv) return { error: 'Error creando invitacion' }

  // Get workspace name
  const { data: ws } = await supabase
    .from('workspaces')
    .select('name, slug')
    .eq('id', profile.workspace_id)
    .single()

  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'localhost:3000'
  const isLocal = process.env.NODE_ENV === 'development'
  const acceptUrl = isLocal
    ? `http://localhost:3000/accept-invite?token=${inv.token}`
    : `https://${ws?.slug || 'app'}.${baseDomain}/accept-invite?token=${inv.token}`

  // Send invitation email via Resend
  try {
    await resend.emails.send({
      from: 'MéTRIK ONE <cotizaciones@metrikone.co>',
      to: normalizedEmail,
      subject: `${ws?.name || 'Tu empresa'} te invita a MéTRIK ONE`,
      html: `
        <div style="font-family: 'Montserrat', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
          <h2 style="color: #1A1A1A; margin-bottom: 8px;">Hola ${staffMember.full_name},</h2>
          <p style="color: #6B7280; font-size: 14px; line-height: 1.6;">
            <strong>${ws?.name || 'Tu empresa'}</strong> te invita a usar MéTRIK ONE para gestionar el negocio juntos.
          </p>
          <a href="${acceptUrl}" style="display: inline-block; background: #10B981; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 24px 0;">
            Aceptar invitacion
          </a>
          <p style="color: #9CA3AF; font-size: 12px; margin-top: 24px;">
            Este enlace expira en 7 dias. Si no esperabas esta invitacion, puedes ignorar este correo.
          </p>
        </div>
      `,
    })
  } catch {
    return { error: 'Error enviando email. Verifica el correo e intenta de nuevo.' }
  }

  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  return { success: true, email: normalizedEmail }
}
