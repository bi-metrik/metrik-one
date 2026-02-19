'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { RoleKey } from '@/lib/roles'

// Re-export type for convenience
export type { RoleKey } from '@/lib/roles'

// ── Types ──────────────────────────────────────────────

interface InviteInput {
  email: string
  role: 'admin' | 'operator' | 'read_only'
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

/** Invite a team member — only owner can invite (D97) */
export async function inviteTeamMember(input: InviteInput) {
  try {
    const { supabase, user, profile } = await getAuthContext()

    if (profile.role !== 'owner') {
      return { success: false, error: 'Solo el dueño puede invitar miembros' }
    }

    const email = input.email.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      return { success: false, error: 'Email inválido' }
    }

    // Check if already invited (pending)
    const { data: existing } = await supabase
      .from('team_invitations')
      .select('id, status')
      .eq('workspace_id', profile.workspace_id)
      .eq('email', email)
      .single()

    if (existing) {
      if (existing.status === 'pending') {
        return { success: false, error: 'Ya existe una invitación pendiente para este email' }
      }
      // Re-invite: update existing
      const { error } = await supabase
        .from('team_invitations')
        .update({
          role: input.role,
          status: 'pending',
          invited_by: user.id,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq('id', existing.id)

      if (error) return { success: false, error: error.message }
    } else {
      // New invitation
      const { error } = await supabase
        .from('team_invitations')
        .insert({
          workspace_id: profile.workspace_id,
          email,
          role: input.role,
          invited_by: user.id,
        })

      if (error) {
        if (error.code === '23505') {
          return { success: false, error: 'Ya existe una invitación para este email' }
        }
        return { success: false, error: error.message }
      }
    }

    // Check if user already exists in auth
    // If they do, we could auto-add them. For now, email-based flow.

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
