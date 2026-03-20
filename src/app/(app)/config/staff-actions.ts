'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

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

/** Invite a staff member to the platform via Supabase magic link */
export async function inviteStaffToPlataform(staffId: string, email: string) {
  try {
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
    const { data: staffMember, error: staffErr } = await supabase
      .from('staff')
      .select('id, full_name, profile_id, rol_plataforma, workspace_id')
      .eq('id', staffId)
      .eq('workspace_id', profile.workspace_id)
      .maybeSingle()

    if (staffErr) return { error: `Error buscando staff: ${staffErr.message}` }
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
    const normalizedEmail = email.trim().toLowerCase()

    // Expire any previous pending invitations for this email
    await supabase
      .from('team_invitations')
      .update({ status: 'expired' })
      .eq('workspace_id', profile.workspace_id)
      .eq('email', normalizedEmail)
      .eq('status', 'pending')

    // Create new invitation
    const { error: insertError } = await supabase
      .from('team_invitations')
      .insert({
        workspace_id: profile.workspace_id,
        email: normalizedEmail,
        role: inviteRole,
        invited_by: user.id,
      })
    if (insertError) return { error: `Error creando invitacion: ${insertError.message}` }

    // Get workspace slug for redirect
    const { data: ws } = await supabase
      .from('workspaces')
      .select('slug')
      .eq('id', profile.workspace_id)
      .maybeSingle()

    const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'localhost:3000'
    const isLocal = process.env.NODE_ENV === 'development'
    const siteUrl = isLocal
      ? 'http://localhost:3000'
      : `https://${ws?.slug || 'app'}.${baseDomain}`

    // Send magic link via Supabase Auth (uses Supabase's built-in email)
    const serviceClient = createServiceClient()
    const { error: inviteErr } = await serviceClient.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo: `${siteUrl}/auth/callback?redirectTo=/accept-invite`,
      data: {
        full_name: staffMember.full_name,
        invited_role: inviteRole,
        workspace_id: profile.workspace_id,
      },
    })

    if (inviteErr) {
      // If user already exists in auth, send magic link instead
      if (inviteErr.message?.includes('already been registered') || inviteErr.status === 422) {
        const { error: otpErr } = await serviceClient.auth.admin.generateLink({
          type: 'magiclink',
          email: normalizedEmail,
          options: {
            redirectTo: `${siteUrl}/auth/callback?redirectTo=/accept-invite`,
          },
        })
        if (otpErr) return { error: `Error enviando magic link: ${otpErr.message}` }
      } else {
        return { error: `Error invitando: ${inviteErr.message}` }
      }
    }

    revalidatePath('/config')
    revalidatePath('/mi-negocio')
    return { success: true, email: normalizedEmail }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Error inesperado al invitar' }
  }
}
