import { createClient } from '@supabase/supabase-js'

/**
 * Supabase client for Mi Bolsillo project (read-only admin access).
 * Uses service role key to bypass RLS — server-only.
 */
export function createMiBolsilloClient() {
  const url = process.env.MIBOLSILLO_SUPABASE_URL
  const key = process.env.MIBOLSILLO_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing MIBOLSILLO_SUPABASE_URL or MIBOLSILLO_SERVICE_ROLE_KEY')
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
