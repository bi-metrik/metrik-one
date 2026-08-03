import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { usuarioDesdeToken } from './claims-user'

// Cookies host-only — la lib auth-js rechaza domain cross-subdomain.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANTE: sigue prohibido `getSession()` — lee la cookie y confía en ella.
  // `usuarioDesdeToken` usa `getClaims()`, que VERIFICA LA FIRMA del JWT contra el
  // JWKS del proyecto: misma garantía que `getUser()`, sin round-trip al servidor
  // de Auth en cada request (medido: 165 ms → 0 ms). Ver `claims-user.ts`.
  const { user } = await usuarioDesdeToken(supabase)

  return { user, supabaseResponse, supabase }
}
