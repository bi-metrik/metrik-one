/**
 * Dispara generación de cuentas de cobro junio 2026 — workspace metrik.
 *
 * Idempotente: usa generarCuentasCobroPeriodo con service role client.
 * Si ya existe cuenta para (workspace, año, mes, empresa) la salta.
 * Emisión fechada el día 13 (envío); vencimiento día 15 (interno).
 *
 * Uso:
 *   cd metrik-one
 *   npx tsx scripts/generar-cuentas-junio-metrik.ts          # dry-run (preview, no toca DB/Drive)
 *   npx tsx scripts/generar-cuentas-junio-metrik.ts --commit # real
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const WS_METRIK_ID = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
const ANIO = 2026
const MES = 6
const COMMIT = process.argv.includes('--commit')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

async function main() {
  const sb = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!)
  const { generarCuentasCobroPeriodo } = await import('../src/lib/cobros/generar-cuentas-cobro')

  console.log(`▶ Cuentas de cobro ${ANIO}-${String(MES).padStart(2, '0')} — workspace metrik`)
  console.log(`  modo: ${COMMIT ? 'REAL (--commit)' : 'dry-run'} · emisión: ${ANIO}-${MES}-13 · vence: ${ANIO}-${MES}-15\n`)

  const result = await generarCuentasCobroPeriodo(
    sb as never,
    WS_METRIK_ID,
    ANIO,
    MES,
    {
      dryRun: !COMMIT,
      isDraft: false,
      fechaEmisionOverride: `${ANIO}-${String(MES).padStart(2, '0')}-13`,
    },
  )

  console.log(`✓ creadas: ${result.cuentasCreadas} · omitidas (ya existían): ${result.cuentasOmitidas}`)
  for (const d of result.detalles) {
    console.log(`  · [${d.estado}] ${d.numero ?? '—'} — ${d.empresa_nombre} — $${d.monto_total.toLocaleString('es-CO')}`)
    if (d.pdf_drive_url) console.log(`      Drive: ${d.pdf_drive_url}`)
  }
  if (result.errores.length) {
    console.log(`\n✗ errores (${result.errores.length}):`)
    for (const e of result.errores) console.log(`  - ${e.empresa_id}: ${e.error}`)
  }
}

main().catch((e) => {
  console.error('✗ Error:', e instanceof Error ? e.message : e)
  process.exit(1)
})
