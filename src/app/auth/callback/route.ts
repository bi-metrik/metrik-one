import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const redirectTo = searchParams.get('redirectTo') || searchParams.get('next') || '/numeros'
  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'localhost:3000'
  const isLocalEnv = process.env.NODE_ENV === 'development'

  if (code) {
    const supabase = await createClient()
    const { error, data } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      // Check if user has a profile (existing user vs new registration)
      const { data: profile } = await supabase
        .from('profiles')
        .select('workspace_id')
        .eq('id', data.user.id)
        .single()

      if (profile?.workspace_id) {
        // Existing user → redirect to their tenant workspace
        const { data: ws } = await supabase
          .from('workspaces')
          .select('slug')
          .eq('id', profile.workspace_id)
          .single()

        if (ws?.slug) {
          // Sanitize redirectTo to prevent open redirect
          const safePath = redirectTo.startsWith('/') ? redirectTo : '/dashboard'
          if (isLocalEnv) {
            return NextResponse.redirect(`${origin}${safePath}`)
          }
          return NextResponse.redirect(`https://${ws.slug}.${baseDomain}${safePath}`)
        }
      }

      // New user — check if they have a pending invitation
      // Use service client because the user has no profile yet → RLS blocks team_invitations
      const userEmail = data.user.email?.toLowerCase()
      if (userEmail) {
        const serviceClient = createServiceClient()
        const { data: pendingInvite } = await serviceClient
          .from('team_invitations')
          .select('workspace_id')
          .eq('email', userEmail)
          .eq('status', 'pending')
          .limit(1)
          .maybeSingle()

        if (pendingInvite) {
          // Invited user → redirect to accept-invite (skips onboarding)
          const targetPath = '/accept-invite'
          if (isLocalEnv) {
            return NextResponse.redirect(`${origin}${targetPath}`)
          }
          const { data: invWs } = await serviceClient
            .from('workspaces')
            .select('slug')
            .eq('id', pendingInvite.workspace_id)
            .single()
          if (invWs?.slug) {
            return NextResponse.redirect(`https://${invWs.slug}.${baseDomain}${targetPath}`)
          }
          return NextResponse.redirect(`${origin}${targetPath}`)
        }
      }

      // No invitation → regular onboarding
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}/onboarding`)
      }
      const forwardedHost = request.headers.get('x-forwarded-host')
      if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}/onboarding`)
      }
      return NextResponse.redirect(`${origin}/onboarding`)
    }
  }

  // Auth error — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
