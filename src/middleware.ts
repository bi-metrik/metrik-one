import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

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

/** Role-aware landing: check permissions + workspace config */
const ROLES_WITH_NUMBERS = ['owner', 'admin', 'supervisor', 'read_only']
// Contador: acceso exclusivo a /causacion
const CONTADOR_ONLY_ROLE = 'contador'

async function getLanding(supabase: Awaited<ReturnType<typeof updateSession>>['supabase'], role?: string, workspaceId?: string): Promise<string> {
  if (role === CONTADOR_ONLY_ROLE) return '/causacion'

  // Check workspace modules — compliance-only skips business landing
  if (workspaceId) {
    const { data: ws } = await supabase
      .from('workspaces')
      .select('modules')
      .eq('id', workspaceId)
      .single()
    const modules = (ws?.modules as Record<string, boolean> | null) ?? { business: true }
    if (!modules.business) {
      if (modules.compliance) return '/riesgos'
      return '/mi-negocio'
    }
  }

  if (role && !ROLES_WITH_NUMBERS.includes(role)) {
    return '/negocios'
  }
  const { count } = await supabase
    .from('config_metas')
    .select('*', { count: 'exact', head: true })
  return (count && count > 0) ? '/numeros' : '/mi-negocio'
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

    // Always allow auth callback and accept-invite
    if (pathname.startsWith('/auth/callback')) return supabaseResponse
    if (pathname === '/accept-invite') return supabaseResponse

    // Not authenticated → login on marketing domain
    if (!user) {
      const loginUrl = IS_DEV
        ? new URL('/login', request.url)
        : new URL(`https://${BASE_DOMAIN}/login`)
      loginUrl.searchParams.set('redirectTo', pathname)
      return NextResponse.redirect(loginUrl)
    }

    // Root → role-based landing
    if (pathname === '/') {
      const { data: tenantProfile } = await supabase
        .from('profiles')
        .select('role, workspace_id')
        .eq('id', user.id)
        .single()
      const landing = await getLanding(supabase, tenantProfile?.role ?? undefined, tenantProfile?.workspace_id ?? undefined)
      return NextResponse.redirect(new URL(landing, request.url))
    }

    // Guard: contador can only access /causacion
    if (pathname !== '/causacion' && !pathname.startsWith('/causacion/') && !pathname.startsWith('/auth/')) {
      const { data: tenantProfile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      if (tenantProfile?.role === 'contador') {
        return NextResponse.redirect(new URL('/causacion', request.url))
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
      const res = NextResponse.redirect(cleanUrl)
      if (devWs === 'off') {
        res.cookies.delete('__dev_ws')
      } else {
        res.cookies.set('__dev_ws', devWs, { path: '/', httpOnly: true, sameSite: 'lax' })
      }
      return res
    }
  }

  if (pathname.startsWith('/auth/callback')) return supabaseResponse
  if (pathname === '/registro') return supabaseResponse
  if (pathname === '/accept-invite') return supabaseResponse

  // Onboarding route — allow for authenticated users without profile
  if (pathname === '/onboarding') {
    if (!user) {
      return NextResponse.redirect(new URL('/registro', request.url))
    }
    return supabaseResponse
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
            return NextResponse.redirect(new URL(landing, request.url))
          }
          return NextResponse.redirect(`https://${ws.slug}.${BASE_DOMAIN}${landing}`)
        }
      }

      // User exists but no profile → check for invite redirect, otherwise onboarding
      const redirectParam = request.nextUrl.searchParams.get('redirectTo')
      if (redirectParam === '/accept-invite') {
        return NextResponse.redirect(new URL('/accept-invite', request.url))
      }
      return NextResponse.redirect(new URL('/onboarding', request.url))
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
            return NextResponse.redirect(new URL(landing, request.url))
          }
          return NextResponse.redirect(`https://${ws.slug}.${BASE_DOMAIN}${landing}`)
        }
      }

      // User exists but no profile → onboarding
      return NextResponse.redirect(new URL('/onboarding', request.url))
    }
    return supabaseResponse
  }

  // Protected app routes — redirect to login if not authenticated
  const protectedPaths = ['/numeros', '/negocios', '/pipeline', '/proyectos', '/directorio', '/nuevo', '/gastos', '/config', '/mi-negocio', '/story-mode', '/tableros', '/causacion', '/equipo', '/movimientos']
  if (protectedPaths.some(p => pathname.startsWith(p)) && !user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
