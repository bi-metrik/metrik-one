/**
 * Emite (o revoca) un token del endpoint `/api/ferreteria/*` del módulo Ferretería.
 *
 * Los dos escritores sin sesión —el agente de MeTRIK y el cron del Mac— se autentican con
 * `Authorization: Bearer fer_...`. La base guarda SOLO el sha256 del token
 * (`ferreteria_tokens.token_hash`); el token en claro se imprime UNA vez y no se puede recuperar.
 *
 * Simulación por defecto: sin `--apply` no escribe nada.
 *
 * Uso:
 *   npx tsx scripts/emitir-token-ferreteria.ts <slug> --escritor cron|agente --nombre "Cron Mac" [--apply]
 *   npx tsx scripts/emitir-token-ferreteria.ts <slug> --revocar <prefijo fer_xxxxxx> [--apply]
 *   npx tsx scripts/emitir-token-ferreteria.ts <slug> --listar
 *
 * Después de emitir: guardar el token donde lo lea quien lo usa (el cron del Mac lo lee de su
 * propio archivo de secretos; Kaori lo registra en `.credentials.md`). Nunca en el repo.
 *
 * Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Correrlo desde la raíz de metrik-one (no desde un subdirectorio).
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
import { generarToken, hashToken, prefijoVisible } from '../src/lib/ferreteria/token'

config({ path: resolve(process.cwd(), '.env.local') })

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const slug = process.argv[2]
const apply = process.argv.includes('--apply')
const listar = process.argv.includes('--listar')
const revocar = arg('--revocar')
const escritor = arg('--escritor')
const nombre = arg('--nombre')

if (!slug || slug.startsWith('--')) {
  console.error('Uso: npx tsx scripts/emitir-token-ferreteria.ts <slug> --escritor cron|agente --nombre "<nombre>" [--apply]')
  process.exit(1)
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local')
  process.exit(1)
}
const db = createClient(URL, KEY, { auth: { persistSession: false } })

async function main() {
  const { data: ws, error } = await db.from('workspaces').select('id, slug, modules').eq('slug', slug).maybeSingle()
  if (error) throw error
  if (!ws) throw new Error(`No existe el workspace ${slug}`)
  if ((ws.modules as Record<string, unknown> | null)?.ferreteria !== true) {
    throw new Error(`El workspace ${slug} no tiene activo el módulo ferreteria`)
  }

  if (listar) {
    const { data, error: e } = await db
      .from('ferreteria_tokens')
      .select('prefijo, nombre, escritor, created_at, revocado_at, ultimo_uso_at')
      .eq('workspace_id', ws.id)
      .order('created_at')
    if (e) throw e
    console.table(data)
    return
  }

  if (revocar) {
    const { data: filas, error: e } = await db
      .from('ferreteria_tokens')
      .select('id, prefijo, nombre, revocado_at')
      .eq('workspace_id', ws.id)
      .eq('prefijo', revocar)
    if (e) throw e
    if (!filas || filas.length !== 1) throw new Error(`Se esperaba un token con prefijo ${revocar}; hay ${filas?.length ?? 0}`)
    if (filas[0].revocado_at) throw new Error('Ese token ya está revocado')
    if (!apply) {
      console.log(`[simulación] Revocaría ${filas[0].prefijo} (${filas[0].nombre}). Repite con --apply.`)
      return
    }
    const { error: e2 } = await db.from('ferreteria_tokens').update({ revocado_at: new Date().toISOString() }).eq('id', filas[0].id)
    if (e2) throw e2
    console.log(`Revocado ${filas[0].prefijo}.`)
    return
  }

  if (escritor !== 'cron' && escritor !== 'agente') throw new Error('--escritor tiene que ser cron o agente')
  if (!nombre?.trim()) throw new Error('Falta --nombre')

  if (!apply) {
    console.log(`[simulación] Emitiría un token «${escritor}» llamado «${nombre}» para ${slug}. Repite con --apply.`)
    return
  }

  const token = generarToken()
  const { error: e } = await db.from('ferreteria_tokens').insert({
    workspace_id: ws.id,
    nombre: nombre.trim(),
    escritor,
    token_hash: hashToken(token),
    prefijo: prefijoVisible(token),
  })
  if (e) throw e
  console.log('Token emitido. Se muestra UNA sola vez; guárdalo ahora:')
  console.log(token)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
