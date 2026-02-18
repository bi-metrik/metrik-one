import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
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
        // Existing user → redirect to dashboard
        // TODO: Once wildcard SSL is configured, use subdomain redirect:
        // return NextResponse.redirect(`https://${ws.slug}.${baseDomain}/dashboard`)
        return NextResponse.redirect(`${origin}/dashboard`)
      }

      // New user → redirect to onboarding
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
