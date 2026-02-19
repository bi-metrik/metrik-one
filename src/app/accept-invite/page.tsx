import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

/**
 * Accept Invitation Page — D99: <2 min onboarding
 * URL: /accept-invite?token=xxx
 *
 * Flow:
 * 1. Validate token
 * 2. If user logged in → join workspace
 * 3. If not logged in → redirect to signup with token in searchParams
 */
export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const params = await searchParams
  const token = params.token

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="mx-auto max-w-sm space-y-4 rounded-xl border bg-card p-8 text-center">
          <h1 className="text-xl font-bold">Invitación inválida</h1>
          <p className="text-sm text-muted-foreground">
            Este enlace de invitación no es válido o ha expirado.
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

  const supabase = await createClient()

  // Find the invitation
  const { data: invitation, error: invError } = await supabase
    .from('team_invitations')
    .select('*')
    .eq('token', token)
    .eq('status', 'pending')
    .single()

  if (invError || !invitation) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="mx-auto max-w-sm space-y-4 rounded-xl border bg-card p-8 text-center">
          <h1 className="text-xl font-bold">Invitación no encontrada</h1>
          <p className="text-sm text-muted-foreground">
            Esta invitación ya fue usada, revocada o expiró.
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
    // Mark as expired
    await supabase
      .from('team_invitations')
      .update({ status: 'expired' })
      .eq('id', invitation.id)

    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="mx-auto max-w-sm space-y-4 rounded-xl border bg-card p-8 text-center">
          <h1 className="text-xl font-bold">Invitación expirada</h1>
          <p className="text-sm text-muted-foreground">
            Esta invitación expiró. Pídele al dueño del workspace que te envíe una nueva.
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

  // Check if user is authenticated
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    // Not logged in → redirect to signup with token
    redirect(`/login?invite_token=${token}&email=${encodeURIComponent(invitation.email)}`)
  }

  // User is logged in — check if they already have a profile
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, workspace_id')
    .eq('id', user.id)
    .single()

  if (existingProfile) {
    // User already has a workspace
    if (existingProfile.workspace_id === invitation.workspace_id) {
      // Already in this workspace
      await supabase
        .from('team_invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invitation.id)

      redirect('/dashboard')
    }

    // Different workspace — for now, show message
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="mx-auto max-w-sm space-y-4 rounded-xl border bg-card p-8 text-center">
          <h1 className="text-xl font-bold">Ya tienes un workspace</h1>
          <p className="text-sm text-muted-foreground">
            Tu cuenta ya pertenece a otro workspace. En una próxima versión podrás pertenecer a múltiples workspaces.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Ir a mi dashboard
          </Link>
        </div>
      </div>
    )
  }

  // Create profile in the invitation's workspace
  const { error: profileError } = await supabase
    .from('profiles')
    .insert({
      id: user.id,
      workspace_id: invitation.workspace_id,
      full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Nuevo miembro',
      role: invitation.role,
    })

  if (profileError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="mx-auto max-w-sm space-y-4 rounded-xl border bg-card p-8 text-center">
          <h1 className="text-xl font-bold">Error</h1>
          <p className="text-sm text-muted-foreground">
            No se pudo unirte al workspace. Intenta de nuevo o contacta al dueño.
          </p>
        </div>
      </div>
    )
  }

  // Mark invitation as accepted
  await supabase
    .from('team_invitations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invitation.id)

  // Redirect to dashboard
  redirect('/dashboard')
}
