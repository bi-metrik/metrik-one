'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { RoleKey } from '@/lib/roles'

// Re-export type for convenience
export type { RoleKey } from '@/lib/roles'

// ── Types ──────────────────────────────────────────────

type InviteRole = 'owner' | 'admin' | 'supervisor' | 'operator' | 'read_only'

interface InviteInput {
  email: string
  role: InviteRole
}

// ── Server Actions ─────────────────────────────────────

async function getAuthContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()
  if (!profile) throw new Error('Perfil no encontrado')

  return { supabase, user, profile }
}

/** Invite a team member — only owner can invite (D97). Invitar como owner = transfer (validacion explicita). */
export async function inviteTeamMember(input: InviteInput) {
  try {
    const { supabase, user, profile } = await getAuthContext()

    if (profile.role !== 'owner') {
      return { success: false, error: 'Solo el dueño puede invitar miembros' }
    }

    // Owner-as-invite es transfer de ownership: solo owner puede emitirlo (cubierto arriba, explicito por defensa)
    if (input.role === 'owner' && profile.role !== 'owner') {
      return { success: false, error: 'Solo el dueño actual puede transferir ownership' }
    }

    const email = input.email.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      return { success: false, error: 'Email inválido' }
    }

    // Upsert invitation: reutiliza fila existente por (workspace_id, email) o crea nueva
    const { error: upsertError } = await supabase
      .from('team_invitations')
      .upsert({
        workspace_id: profile.workspace_id,
        email,
        role: input.role,
        invited_by: user.id,
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }, {
        onConflict: 'workspace_id,email',
      })

    if (upsertError) {
      return { success: false, error: `Error creando invitacion: ${upsertError.message}` }
    }

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

    // Send invitation email via Supabase Auth (uses Supabase's built-in email)
    const serviceClient = createServiceClient()
    const { error: inviteErr } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?redirectTo=/accept-invite`,
      data: {
        invited_role: input.role,
        workspace_id: profile.workspace_id,
      },
    })

    if (inviteErr) {
      // Si el usuario ya existe en auth, enviar email custom con link a /login (mismo patron que staff-actions.ts)
      // No se puede usar generateLink porque PKCE requiere code_verifier del navegador
      if (inviteErr.message?.includes('already been registered') || inviteErr.status === 422) {
        const resendKey = process.env.RESEND_API_KEY
        if (!resendKey) {
          return { success: false, error: 'RESEND_API_KEY no configurada para reinvitar usuarios existentes' }
        }

        const loginUrl = `${siteUrl}/login?redirectTo=/accept-invite`
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'MéTRIK ONE <noreply@metrikone.co>',
            to: [email],
            subject: 'Te invitaron a MéTRIK ONE',
            html: `<h2>Te invitaron a MéTRIK ONE</h2>
<p>Te invitaron a unirte a un workspace en MéTRIK ONE.</p>
<p>Inicia sesion con tu correo para aceptar la invitacion:</p>
<p><a href="${loginUrl}" style="display:inline-block;padding:12px 24px;background-color:#10B981;color:white;text-decoration:none;border-radius:8px;font-weight:600;">Iniciar sesion</a></p>
<p style="color:#6B7280;font-size:14px;">Al iniciar sesion, seras redirigido automaticamente al workspace.</p>`,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          return { success: false, error: `Error enviando email: ${(err as { message?: string }).message || res.statusText}` }
        }
      } else {
        return { success: false, error: `Error invitando: ${inviteErr.message}` }
      }
    }

    revalidatePath('/config')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

/** List team members + pending invitations */
export async function getTeamMembers() {
  try {
    const { supabase, profile } = await getAuthContext()

    // Get all profiles in workspace
    const { data: members } = await supabase
      .from('profiles')
      .select('id, full_name, role, avatar_url, created_at')
      .eq('workspace_id', profile.workspace_id)
      .order('created_at', { ascending: true })

    // Get pending invitations
    const { data: invitations } = await supabase
      .from('team_invitations')
      .select('*')
      .eq('workspace_id', profile.workspace_id)
      .in('status', ['pending'])
      .order('created_at', { ascending: false })

    return {
      success: true,
      members: members || [],
      invitations: invitations || [],
    }
  } catch (err) {
    return { success: false, members: [], invitations: [], error: err instanceof Error ? err.message : 'Error' }
  }
}

/** Revoke a pending invitation — only owner */
export async function revokeInvitation(invitationId: string) {
  try {
    const { supabase, profile } = await getAuthContext()

    if (profile.role !== 'owner') {
      return { success: false, error: 'Solo el dueño puede revocar invitaciones' }
    }

    const { error } = await supabase
      .from('team_invitations')
      .update({ status: 'revoked' })
      .eq('id', invitationId)
      .eq('workspace_id', profile.workspace_id)

    if (error) return { success: false, error: error.message }

    revalidatePath('/config')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Error' }
  }
}

/** Change a team member's role — only owner */
export async function changeTeamMemberRole(memberId: string, newRole: RoleKey) {
  try {
    const { supabase, profile } = await getAuthContext()

    if (profile.role !== 'owner') {
      return { success: false, error: 'Solo el dueño puede cambiar roles' }
    }

    // Can't change own role
    const { data: { user } } = await supabase.auth.getUser()
    if (memberId === user?.id) {
      return { success: false, error: 'No puedes cambiar tu propio rol' }
    }

    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', memberId)
      .eq('workspace_id', profile.workspace_id)

    if (error) return { success: false, error: error.message }

    revalidatePath('/config')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Error' }
  }
}

/** Remove a member from workspace — only owner */
export async function removeTeamMember(memberId: string) {
  try {
    const { supabase, profile } = await getAuthContext()

    if (profile.role !== 'owner') {
      return { success: false, error: 'Solo el dueño puede eliminar miembros' }
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (memberId === user?.id) {
      return { success: false, error: 'No puedes eliminarte a ti mismo' }
    }

    // Set role to removed (soft delete — they keep their profile but lose access)
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', memberId)
      .eq('workspace_id', profile.workspace_id)

    if (error) return { success: false, error: error.message }

    revalidatePath('/config')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Error' }
  }
}
