import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import { landingForWorkspace } from '@/lib/auth/landing'

// Slugs reservados — mismo set que middleware.ts
const RESERVED_SLUGS = ['www', 'api', 'admin', 'app', 'test', 'demo', 'staging', 'mail', 'ftp']

function extractSlugFromHost(host: string | null, baseDomain: string, isDev: boolean): string | null {
  if (!host) return null
  const hostWithoutPort = host.split(':')[0]
  const baseWithoutPort = baseDomain.split(':')[0]
  if (isDev) {
    if (hostWithoutPort !== baseWithoutPort && hostWithoutPort.endsWith(`.${baseWithoutPort}`)) {
      const slug = hostWithoutPort.replace(`.${baseWithoutPort}`, '')
      if (slug && !RESERVED_SLUGS.includes(slug)) return slug
    }
  } else {
    if (host.endsWith(baseDomain) && host !== baseDomain) {
      const slug = host.replace(`.${baseDomain}`, '')
      if (slug && !RESERVED_SLUGS.includes(slug)) return slug
    }
  }
  return null
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const redirectTo = searchParams.get('redirectTo') || searchParams.get('next') || '/numeros'
  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'localhost:3000'
  const isLocalEnv = process.env.NODE_ENV === 'development'
  const forwardedHost = request.headers.get('x-forwarded-host')
  const requestHost = forwardedHost || request.headers.get('host')
  const hostSlug = extractSlugFromHost(requestHost, baseDomain, isLocalEnv)

  // Helper: post-auth routing (existing user → tenant; pending invite → /accept-invite; else → /onboarding)
  async function routeAfterAuth(user: User) {
    const supabase = await createClient()

    type ProfileExt = { workspace_id: string | null; role: string | null; home_workspace_id: string | null; platform_admin: boolean }
    const { data: profileData } = await supabase
      .from('profiles')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select('workspace_id, role, home_workspace_id, platform_admin' as any)
      .eq('id', user.id)
      .single()
    const profile = (profileData as unknown as ProfileExt | null) ?? null

    if (profile?.workspace_id) {
      // Si el callback llego a un subdomain especifico (hostSlug) Y el user es
      // platform_admin Y el slug del host pertenece a un workspace distinto al
      // workspace_id actual del profile → auto-switch al workspace del host.
      // Materializa "metrik por defecto cuando entro a metrik.metrikone.co" sin
      // forzar al user a pasar por el dropdown Admin para cambiar.
      if (hostSlug && profile.platform_admin) {
        const svc = createServiceClient()
        const { data: hostWs } = await svc
          .from('workspaces')
          .select('id, slug')
          .eq('slug', hostSlug)
          .single()
        if (hostWs && hostWs.id !== profile.workspace_id) {
          const updates: { workspace_id: string; home_workspace_id?: string } = { workspace_id: hostWs.id }
          if (!profile.home_workspace_id) updates.home_workspace_id = profile.workspace_id
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await svc.from('profiles').update(updates as any).eq('id', user.id)
          await svc.from('activity_log').insert({
            workspace_id: hostWs.id,
            entidad_tipo: 'workspace',
            entidad_id: hostWs.id,
            tipo: 'platform_admin_enter',
            autor_id: user.id,
            contenido: `Platform admin entro al workspace via subdomain ${hostSlug}.${baseDomain}`,
          })
          // Reapuntar destino al subdomain del host (que es donde queremos quedar)
          profile.workspace_id = hostWs.id
        }
      }

      const { data: ws } = await supabase
        .from('workspaces')
        .select('slug, modules')
        .eq('id', profile.workspace_id)
        .single()

      if (ws?.slug) {
        let safePath = redirectTo
        if (!searchParams.get('redirectTo') && !searchParams.get('next')) {
          // Fuente unica de verdad (compartida con middleware y accept-invite)
          safePath = landingForWorkspace(profile.role || undefined, (ws.modules as Record<string, boolean> | null) ?? null)
        }
        if (!safePath.startsWith('/')) safePath = landingForWorkspace(profile.role || undefined, (ws.modules as Record<string, boolean> | null) ?? null)
        if (isLocalEnv) return NextResponse.redirect(`${origin}${safePath}`)
        return NextResponse.redirect(`https://${ws.slug}.${baseDomain}${safePath}`)
      }
    }

    // Sin workspace asignado — no hay self-serve ni invitaciones. La creacion y
    // activacion de usuarios esta centralizada en MeTRIK. Lo maneja /sin-espacio.
    if (isLocalEnv) return NextResponse.redirect(`${origin}/sin-espacio`)
    if (forwardedHost) return NextResponse.redirect(`https://${forwardedHost}/sin-espacio`)
    return NextResponse.redirect(`${origin}/sin-espacio`)
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
