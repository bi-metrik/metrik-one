import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

/** Landing page based on role permissions */
function getLandingForRole(role: string): string {
  if (role === 'contador') return '/causacion'
  const rolesWithNumbers = ['owner', 'admin', 'supervisor', 'read_only']
  if (rolesWithNumbers.includes(role)) return '/numeros'
  return '/pipeline'
}

/**
 * Accept Invitation Page
 *
 * Two flows:
 * 1. Token-based: /accept-invite?token=xxx (legacy, link compartido)
 * 2. Magic link: /accept-invite (usuario llega autenticado via magic link, busca invitacion por email)
 */
export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const params = await searchParams
  const token = params.token

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Use service client to bypass RLS — invited user has no profile yet
  const serviceClient = createServiceClient()

  // Find invitation: by token or by authenticated user's email
  let invitation: any = null

  if (token) {
    const { data } = await serviceClient
      .from('team_invitations')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .maybeSingle()
    invitation = data
  }

  if (!invitation && user?.email) {
    // Magic link flow: find pending invitation by email
    const { data } = await serviceClient
      .from('team_invitations')
      .select('*')
      .eq('email', user.email.toLowerCase())
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    invitation = data
  }

  if (!invitation) {
    // No token and not authenticated, or no invitation found
    if (!user && token) {
      redirect(`/login?invite_token=${token}`)
    }
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="mx-auto max-w-sm space-y-4 rounded-xl border bg-card p-8 text-center">
          <h1 className="text-xl font-bold">Invitacion no encontrada</h1>
          <p className="text-sm text-muted-foreground">
            Esta invitacion ya fue usada, revocada o expiro.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Ir al login
          </Link>
        </div>
      </div>
    )
  }

  // Check if expired
  if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
    await serviceClient
      .from('team_invitations')
      .update({ status: 'expired' })
      .eq('id', invitation.id)

    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="mx-auto max-w-sm space-y-4 rounded-xl border bg-card p-8 text-center">
          <h1 className="text-xl font-bold">Invitacion expirada</h1>
          <p className="text-sm text-muted-foreground">
            Esta invitacion expiro. Pidele al dueno del workspace que te envie una nueva.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Ir al login
          </Link>
        </div>
      </div>
    )
  }

  if (!user) {
    // Not logged in → redirect to login
    redirect(`/login?invite_token=${invitation.token}&email=${encodeURIComponent(invitation.email)}`)
  }

  // User is logged in — check if they already have a profile
  const { data: existingProfile } = await serviceClient
    .from('profiles')
    .select('id, workspace_id')
    .eq('id', user.id)
    .maybeSingle()

  if (existingProfile) {
    if (existingProfile.workspace_id === invitation.workspace_id) {
      // Already in this workspace — just accept and redirect
      await serviceClient
        .from('team_invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invitation.id)

      // Link staff if not already linked
      await serviceClient
        .from('staff')
        .update({ profile_id: user.id })
        .eq('workspace_id', invitation.workspace_id)
        .is('profile_id', null)
        .eq('is_active', true)
        .ilike('full_name', user.user_metadata?.full_name || user.email?.split('@')[0] || '')

      redirect(getLandingForRole(invitation.role))
    }

    // Different workspace
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="mx-auto max-w-sm space-y-4 rounded-xl border bg-card p-8 text-center">
          <h1 className="text-xl font-bold">Ya tienes un workspace</h1>
          <p className="text-sm text-muted-foreground">
            Tu cuenta ya pertenece a otro workspace. En una proxima version podras pertenecer a multiples workspaces.
          </p>
          <Link
            href="/numeros"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Ir a Numeros
          </Link>
        </div>
      </div>
    )
  }

  // Create profile in the invitation's workspace
  // display_role may come from user_metadata (set during inviteUserByEmail)
  const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Nuevo miembro'
  const displayRoleFromMeta = user.user_metadata?.display_role || null
  const { error: profileError } = await serviceClient
    .from('profiles')
    .insert({
      id: user.id,
      workspace_id: invitation.workspace_id,
      full_name: fullName,
      role: invitation.role,
      display_role: displayRoleFromMeta,
    } as any)

  if (profileError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="mx-auto max-w-sm space-y-4 rounded-xl border bg-card p-8 text-center">
          <h1 className="text-xl font-bold">Error</h1>
          <p className="text-sm text-muted-foreground">
            No se pudo unirte al workspace: {profileError.message}
          </p>
        </div>
      </div>
    )
  }

  // Link staff record by matching invitation email
  const { data: staffMatch } = await serviceClient
    .from('team_invitations')
    .select('email')
    .eq('id', invitation.id)
    .single()

  if (staffMatch) {
    // Find staff that was invited with this email (match by name since staff doesn't store email)
    await serviceClient
      .from('staff')
      .update({ profile_id: user.id })
      .eq('workspace_id', invitation.workspace_id)
      .is('profile_id', null)
      .eq('is_active', true)
      .ilike('full_name', fullName)
  }

  // Mark invitation as accepted
  await serviceClient
    .from('team_invitations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invitation.id)

  redirect(getLandingForRole(invitation.role))
}
