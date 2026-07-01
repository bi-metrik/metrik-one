/**
 * Crea el usuario de solo lectura de Guillermo (HJBC) SIN enviar correo.
 * Guillermo entra luego con magic link a su email; aterriza en el workspace hjbc como read_only.
 *
 *   npx tsx scripts/create-hjbc-readonly-user.ts
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const WORKSPACE_ID = '4018f207-086c-41bb-94cb-ad70a0140742' // HJBC
const EMAIL = 'guillermo.garcia@hjbcgroup.com'
const FULL_NAME = 'Guillermo García'

const env: Record<string, string> = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  // 1. Crear (o recuperar) el usuario en Auth, confirmado y SIN correo de invitacion.
  let userId: string | null = null
  const created = await admin.auth.admin.createUser({
    email: EMAIL,
    email_confirm: true,
    user_metadata: { full_name: FULL_NAME },
  })
  if (created.error) {
    if (/registered|exists/i.test(created.error.message)) {
      // Ya existe: buscarlo por listado
      const list = await admin.auth.admin.listUsers({ perPage: 200 })
      userId = list.data.users.find(u => u.email?.toLowerCase() === EMAIL.toLowerCase())?.id ?? null
      console.log('Usuario ya existia:', userId)
    } else {
      throw created.error
    }
  } else {
    userId = created.data.user?.id ?? null
    console.log('Usuario creado:', userId)
  }
  if (!userId) throw new Error('No se pudo resolver el user id')

  // 2. Upsert del profile como read_only en el workspace hjbc.
  const prof = await admin.from('profiles').upsert({
    id: userId,
    workspace_id: WORKSPACE_ID,
    home_workspace_id: WORKSPACE_ID,
    role: 'read_only',
    full_name: FULL_NAME,
  }, { onConflict: 'id' }).select('id, role, workspace_id').single()
  if (prof.error) throw prof.error
  console.log('Profile:', prof.data)
  console.log('\nOK. Guillermo puede entrar con magic link a', EMAIL, '(solo lectura, workspace hjbc).')
}

main().catch((e) => { console.error(e); process.exit(1) })
