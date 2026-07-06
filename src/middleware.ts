import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { landingForWorkspace } from '@/lib/auth/landing'

// Base domain — dev: localhost, prod: metrikone.co
const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'localhost:3000'
const IS_DEV = process.env.NODE_ENV === 'development'

// Reserved slugs that are NOT tenants
const RESERVED_SLUGS = ['www', 'api', 'admin', 'app', 'test', 'demo', 'staging', 'mail', 'ftp']

/**
 * Extract tenant slug from subdomain
 * Production: ana.metrikone.co → "ana"
 * Development: ana.localhost:3000 → "ana"
 */
function extractSlug(hostname: string): string | null {
  const hostWithoutPort = hostname.split(':')[0]
  const baseDomainWithoutPort = BASE_DOMAIN.split(':')[0]

  if (IS_DEV) {
    if (hostWithoutPort !== baseDomainWithoutPort && hostWithoutPort.endsWith(`.${baseDomainWithoutPort}`)) {
      const slug = hostWithoutPort.replace(`.${baseDomainWithoutPort}`, '')
      if (slug && !RESERVED_SLUGS.includes(slug)) return slug
    }
  } else {
    if (hostname.endsWith(BASE_DOMAIN) && hostname !== BASE_DOMAIN) {
      const slug = hostname.replace(`.${BASE_DOMAIN}`, '')
      if (slug && !RESERVED_SLUGS.includes(slug)) return slug
    }
  }

  return null
}

/**
 * Propaga las cookies de sesion refrescadas (las que `updateSession` escribio en
 * `supabaseResponse` via el callback `setAll`) sobre CUALQUIER NextResponse que el
 * middleware arme (redirect o next). Sin esto, cuando Supabase rota el refresh token
 * y el middleware redirige con una respuesta nueva y vacia, el browser se queda con el
 * token viejo (ya invalidado) -> la siguiente request falla -> bounce a /login.
 * Pitfall documentado de Supabase SSR: "copy over the cookies when creating a new
 * NextResponse, or the session terminates prematurely".
 */
function withAuthCookies(response: NextResponse, supabaseResponse: NextResponse): NextResponse {
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie)
  })
  return response
}

/** Role-aware landing: check permissions + workspace config */
async function getLanding(supabase: Awaited<ReturnType<typeof updateSession>>['supabase'], role?: string, workspaceId?: string): Promise<string> {
  let modules: Record<string, boolean> | null = null
  let modoVitrina = false
  if (workspaceId) {
    const { data: ws } = await supabase
      .from('workspaces')
      .select('modules, config_extra')
      .eq('id', workspaceId)
      .single()
    modules = (ws?.modules as Record<string, boolean> | null) ?? null
    modoVitrina = (ws?.config_extra as { modo_vitrina?: boolean } | null)?.modo_vitrina === true
  }
  // Fuente unica de verdad (compartida con callback de auth y accept-invite)
  return landingForWorkspace(role, modules, modoVitrina)
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  const slug = extractSlug(hostname)
  const { pathname } = request.nextUrl

  // Refresh Supabase session
  const { user, supabaseResponse, supabase } = await updateSession(request)

  // --- TENANT SUBDOMAIN ROUTES ---
  if (slug) {
    supabaseResponse.headers.set('x-tenant-slug', slug)

    // Rutas publicas permitidas en el subdomain sin sesion
    if (pathname.startsWith('/auth/callback')) return supabaseResponse
    if (pathname === '/login') return supabaseResponse
    if (pathname === '/sin-espacio') return supabaseResponse
    // Signup cerrado: registro / onboarding / invitaciones ya no existen -> al login
    if (pathname === '/registro' || pathname === '/onboarding' || pathname === '/accept-invite') {
      return withAuthCookies(NextResponse.redirect(new URL('/login', request.url)), supabaseResponse)
    }
    // Certificacion publica via QR (read-only, sin login). La pagina valida el
    // flag del workspace y solo expone lotes estado='publicado' via service-role.
    if (pathname.startsWith('/cert/')) return supabaseResponse
    if (pathname.startsWith('/c/')) return supabaseResponse

    // No autenticado → login DEL MISMO SUBDOMAIN (no marketing). Asi el magic link
    // siembra sesion en este subdomain via /auth/callback, en lugar de pasar por
    // marketing/login que redirigiria al subdomain del profile.workspace_id actual
    // (rompia el caso platform_admin tecleando un subdomain distinto al activo).
    if (!user) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirectTo', pathname)
      return withAuthCookies(NextResponse.redirect(loginUrl), supabaseResponse)
    }

    // Root → role-based landing
    if (pathname === '/') {
      const { data: tenantProfile } = await supabase
        .from('profiles')
        .select('role, workspace_id')
        .eq('id', user.id)
        .single()
      const landing = await getLanding(supabase, tenantProfile?.role ?? undefined, tenantProfile?.workspace_id ?? undefined)
      return withAuthCookies(NextResponse.redirect(new URL(landing, request.url)), supabaseResponse)
    }

    // Guard: contador can only access /revision
    if (pathname !== '/revision' && !pathname.startsWith('/revision/') && !pathname.startsWith('/auth/')) {
      const { data: tenantProfile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      if (tenantProfile?.role === 'contador') {
        return withAuthCookies(NextResponse.redirect(new URL('/revision', request.url)), supabaseResponse)
      }
    }

    return supabaseResponse
  }

  // --- MARKETING DOMAIN (no subdomain) ---

  // Dev workspace override: ?__ws=<slug> → setea cookie y redirige limpio
  if (IS_DEV) {
    const devWs = request.nextUrl.searchParams.get('__ws')
    if (devWs !== null) {
      const cleanUrl = new URL(request.url)
      cleanUrl.searchParams.delete('__ws')
      const res = withAuthCookies(NextResponse.redirect(cleanUrl), supabaseResponse)
      if (devWs === 'off') {
        res.cookies.delete('__dev_ws')
      } else {
        res.cookies.set('__dev_ws', devWs, { path: '/', httpOnly: true, sameSite: 'lax' })
      }
      return res
    }
  }

  if (pathname.startsWith('/auth/callback')) return supabaseResponse
  if (pathname === '/sin-espacio') return supabaseResponse

  // Signup cerrado: registro / onboarding / invitaciones -> al login
  if (pathname === '/registro' || pathname === '/onboarding' || pathname === '/accept-invite') {
    return withAuthCookies(NextResponse.redirect(new URL('/login', request.url)), supabaseResponse)
  }

  // Login page
  if (pathname === '/login') {
    if (user) {
      // Authenticated → check if has workspace → redirect to tenant subdomain
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
          const landing = await getLanding(supabase, profile.role ?? undefined, profile.workspace_id ?? undefined)
          if (IS_DEV) {
            return withAuthCookies(NextResponse.redirect(new URL(landing, request.url)), supabaseResponse)
          }
          return withAuthCookies(NextResponse.redirect(`https://${ws.slug}.${BASE_DOMAIN}${landing}`), supabaseResponse)
        }
      }

      // Usuario autenticado sin workspace → no hay self-serve, lo maneja /sin-espacio
      return withAuthCookies(NextResponse.redirect(new URL('/sin-espacio', request.url)), supabaseResponse)
    }
    return supabaseResponse
  }

  // Root of marketing domain
  if (pathname === '/') {
    if (user) {
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
          const landing = await getLanding(supabase, profile.role ?? undefined, profile.workspace_id ?? undefined)
          if (IS_DEV) {
            return withAuthCookies(NextResponse.redirect(new URL(landing, request.url)), supabaseResponse)
          }
          return withAuthCookies(NextResponse.redirect(`https://${ws.slug}.${BASE_DOMAIN}${landing}`), supabaseResponse)
        }
      }

      // Usuario autenticado sin workspace → /sin-espacio
      return withAuthCookies(NextResponse.redirect(new URL('/sin-espacio', request.url)), supabaseResponse)
    }
    return supabaseResponse
  }

  // Protected app routes — redirect to login if not authenticated
  const protectedPaths = ['/numeros', '/negocios', '/directorio', '/nuevo', '/gastos', '/config', '/mi-negocio', '/story-mode', '/tableros', '/revision', '/equipo', '/movimientos']
  if (protectedPaths.some(p => pathname.startsWith(p)) && !user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return withAuthCookies(NextResponse.redirect(loginUrl), supabaseResponse)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
