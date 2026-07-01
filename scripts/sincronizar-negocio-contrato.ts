/**
 * CLI del ritual post-firma. Lo invoca el skill /contrato tras detectar el contrato firmado:
 * el agente extrae los datos del contrato .md y los pasa como JSON; este wrapper escribe a ONE.
 *
 * Uso:
 *   cd metrik-one && npx tsx scripts/sincronizar-negocio-contrato.ts <negocio_id> <ruta.json>
 *
 * El JSON = SincronizarNegocioInput (ver src/lib/cobros/sincronizar-negocio-contrato.ts).
 * Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import './_load-env'
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import {
  sincronizarNegocioDesdeContrato,
  type SincronizarNegocioInput,
} from '../src/lib/cobros/sincronizar-negocio-contrato'

async function main() {
  const [negocioId, jsonPath] = process.argv.slice(2)
  if (!negocioId || !jsonPath) {
    console.error('Uso: npx tsx scripts/sincronizar-negocio-contrato.ts <negocio_id> <ruta.json>')
    process.exit(1)
  }

  const input = JSON.parse(readFileSync(jsonPath, 'utf8')) as SincronizarNegocioInput
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  console.log('▶ Sincronizando negocio', negocioId, 'desde contrato')
  const r = await sincronizarNegocioDesdeContrato(supabase, negocioId, input)

  console.log('  negocio actualizado:', r.negocio_actualizado)
  console.log('  empresa actualizada:', r.empresa_actualizada)
  console.log('  contacto actualizado:', r.contacto_actualizado)
  console.log('  plan_id:', r.plan_id, '· cuotas upsert:', r.cuotas_upsert)
  if (r.errores.length) console.log('  ⚠ errores:', r.errores)
  console.log(r.ok ? '\n✅ Sincronización OK' : '\n❌ Sincronización con errores')
  process.exit(r.ok ? 0 : 1)
}

main().catch((e) => {
  console.error('\n❌ ERROR:', e instanceof Error ? e.message : e)
  process.exit(1)
})
