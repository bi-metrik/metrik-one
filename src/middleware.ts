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

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  const slug = extractSlug(hostname)
  const { pathname } = request.nextUrl

  // Refresh Supabase session
  const { user, supabaseResponse, supabase } = await updateSession(request)

  // --- TENANT SUBDOMAIN ROUTES ---
  if (slug) {
    supabaseResponse.headers.set('x-tenant-slug', slug)

    // Always allow auth callback
    if (pathname.startsWith('/auth/callback')) return supabaseResponse

    // Not authenticated → login on marketing domain
    if (!user) {
      const loginUrl = IS_DEV
        ? new URL('/login', request.url)
        : new URL(`https://${BASE_DOMAIN}/login`)
      loginUrl.searchParams.set('redirectTo', pathname)
      return NextResponse.redirect(loginUrl)
    }

    // Root → dashboard
    if (pathname === '/') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    return supabaseResponse
  }

  // --- MARKETING DOMAIN (no subdomain) ---
  if (pathname.startsWith('/auth/callback')) return supabaseResponse
  if (pathname === '/registro') return supabaseResponse

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
        .select('workspace_id')
        .eq('id', user.id)
        .single()

      if (profile?.workspace_id) {
        const { data: ws } = await supabase
          .from('workspaces')
          .select('slug')
          .eq('id', profile.workspace_id)
          .single()

        if (ws?.slug) {
          if (IS_DEV) {
            return NextResponse.redirect(new URL('/dashboard', request.url))
          }
          return NextResponse.redirect(`https://${ws.slug}.${BASE_DOMAIN}/dashboard`)
        }
      }

      // User exists but no profile → onboarding
      return NextResponse.redirect(new URL('/onboarding', request.url))
    }
    return supabaseResponse
  }

  // Root of marketing domain
  if (pathname === '/') {
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('workspace_id')
        .eq('id', user.id)
        .single()

      if (profile?.workspace_id) {
        const { data: ws } = await supabase
          .from('workspaces')
          .select('slug')
          .eq('id', profile.workspace_id)
          .single()

        if (ws?.slug) {
          if (IS_DEV) {
            return NextResponse.redirect(new URL('/dashboard', request.url))
          }
          return NextResponse.redirect(`https://${ws.slug}.${BASE_DOMAIN}/dashboard`)
        }
      }

      // User exists but no profile → onboarding
      return NextResponse.redirect(new URL('/onboarding', request.url))
    }
    return supabaseResponse
  }

  // Protected app routes — redirect to login if not authenticated
  const protectedPaths = ['/dashboard', '/pipeline', '/proyectos', '/numeros', '/gastos', '/config', '/story-mode']
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
