import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const redirectTo = searchParams.get('redirectTo') || searchParams.get('next') || '/numeros'
  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'localhost:3000'
  const isLocalEnv = process.env.NODE_ENV === 'development'
  const forwardedHost = request.headers.get('x-forwarded-host')

  // Helper: post-auth routing (existing user → tenant; pending invite → /accept-invite; else → /onboarding)
  async function routeAfterAuth(user: User) {
    const supabase = await createClient()

    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('id', user.id)
      .single()

    if (profile?.workspace_id) {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('slug')
        .eq('id', profile.workspace_id)
        .single()

      if (ws?.slug) {
        let safePath = redirectTo
        if (!searchParams.get('redirectTo') && !searchParams.get('next')) {
          const rolesWithNumbers = ['owner', 'admin', 'read_only']
          safePath = rolesWithNumbers.includes(profile.role || '') ? '/numeros' : '/pipeline'
        }
        if (!safePath.startsWith('/')) safePath = '/pipeline'
        if (isLocalEnv) return NextResponse.redirect(`${origin}${safePath}`)
        return NextResponse.redirect(`https://${ws.slug}.${baseDomain}${safePath}`)
      }
    }

    // New user — check pending invitation by email (service client bypasses RLS since no profile yet)
    const userEmail = user.email?.toLowerCase()
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
        const targetPath = '/accept-invite'
        if (isLocalEnv) return NextResponse.redirect(`${origin}${targetPath}`)
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

    // Honor explicit /accept-invite redirect even if lookup failed
    if (redirectTo === '/accept-invite') {
      return NextResponse.redirect(`${origin}/accept-invite`)
    }

    // No invitation → onboarding
    if (isLocalEnv) return NextResponse.redirect(`${origin}/onboarding`)
    if (forwardedHost) return NextResponse.redirect(`https://${forwardedHost}/onboarding`)
    return NextResponse.redirect(`${origin}/onboarding`)
  }

  // Branch 1: PKCE flow (?code=...) — login, signup, OAuth
  if (code) {
    const supabase = await createClient()
    const { error, data } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      return routeAfterAuth(data.user)
    }
  }

  // Branch 2: token_hash flow (?token_hash=...&type=...) — invite, signup, magiclink desde links de email nativos
  if (tokenHash && type) {
    const supabase = await createClient()
    const { error, data } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })

    if (!error && data.user) {
      return routeAfterAuth(data.user)
    }
  }

  // Auth error — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
