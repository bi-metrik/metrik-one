import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

// Share Supabase auth cookies across subdomains (tenant.metrikone.co ↔ metrikone.co).
// Critical for magic link flow: PKCE code_verifier cookie se setea al iniciar signInWithOtp
// y debe leerse en el /auth/callback del mismo o distinto subdomain (si el usuario abre el email en otra pestana).
function cookieDomain(): string | undefined {
  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN
  if (!baseDomain || baseDomain.includes('localhost')) return undefined
  return baseDomain
}

export async function createClient() {
  const cookieStore = await cookies()
  const domain = cookieDomain()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, ...(domain ? { domain } : {}) })
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  )
}

export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
