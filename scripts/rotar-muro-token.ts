/**
 * Rota el token del muro publico de un workspace.
 *
 * El muro es publico por enlace y desde v2 lleva facturacion (cierres del dia
 * con montos). Si el enlace se filtra —se reenvia por WhatsApp, queda en el
 * historial de un navegador prestado, lo copia alguien que ya no trabaja alli—
 * hay que poder invalidarlo en un comando, sin tocar SQL y sin apagar el modulo.
 *
 * Eso es todo lo que hace: genera un token nuevo, lo persiste y el anterior
 * deja de resolver (la page busca por `config_extra->>muro_token`, asi que el
 * viejo cae en 404 de inmediato). Hay que volver a pegar la URL nueva en el
 * navegador del televisor.
 *
 * Uso:
 *   npx tsx scripts/rotar-muro-token.ts <slug-workspace>
 *
 * Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const slug = process.argv[2]

if (!slug) {
  console.error('Uso: npx tsx scripts/rotar-muro-token.ts <slug-workspace>')
  process.exit(1)
}
if (!URL || !KEY) {
  console.error('Faltan env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const svc = createClient(URL, KEY, { auth: { persistSession: false } })

async function main() {
  const { data: ws, error } = await svc
    .from('workspaces')
    .select('id, name, modules, config_extra')
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw error
  if (!ws) throw new Error(`No existe el workspace "${slug}".`)

  const modules = (ws.modules as Record<string, boolean> | null) ?? {}
  if (!modules.calidad_llamadas) {
    throw new Error(`El workspace "${slug}" no tiene el modulo calidad_llamadas activo.`)
  }

  const previo = (ws.config_extra as Record<string, unknown>) ?? {}
  const anterior = (previo.muro_token as string | undefined) ?? '(ninguno)'
  const nuevo = randomBytes(12).toString('base64url')

  const { error: eUpd } = await svc
    .from('workspaces')
    .update({ config_extra: { ...previo, muro_token: nuevo, muro_publico: true } })
    .eq('id', ws.id)
  if (eUpd) throw eUpd

  console.log(`workspace   ${slug} (${ws.name})`)
  console.log(`token viejo ${anterior}   <-- ya no resuelve, cae en 404`)
  console.log(`token nuevo ${nuevo}`)
  console.log(`\nURL para el televisor:\n  https://${slug}.metrikone.co/muro/${nuevo}`)
  console.log('\nHay que volver a abrir esa URL en el navegador del televisor.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
