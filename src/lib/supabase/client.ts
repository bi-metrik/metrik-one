import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

// Cookie options con domain compartido entre subdomains. Critico para magic link:
// el code_verifier PKCE se setea aqui (browser) al llamar signInWithOtp y se lee en
// el callback server (posiblemente otra pestana o subdomain distinto).
function cookieDomain(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const host = window.location.hostname
  if (host === 'localhost' || host.endsWith('.localhost') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return undefined
  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? 'metrikone.co'
  // Browsers modernos rechazan el punto inicial (`.metrikone.co`).
  // Pasar `metrikone.co` sin punto — el browser ya entiende que aplica a subdominios.
  return baseDomain
}

export function createClient() {
  const domain = cookieDomain()
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    domain
      ? { cookieOptions: { domain, sameSite: 'lax', secure: true, path: '/' } }
      : undefined,
  )
}
