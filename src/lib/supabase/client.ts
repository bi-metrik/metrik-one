import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

// Sin cookieOptions.domain: cookies host-only. La lib @supabase/auth-js rechaza
// cualquier valor (con o sin punto). El callback magic link va al mismo subdominio,
// asi que la cookie se setea correctamente sin necesidad de cross-subdomain.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
