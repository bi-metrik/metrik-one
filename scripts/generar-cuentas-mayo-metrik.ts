/**
 * Dispara generación de cuentas de cobro mayo 2026 — workspace metrik.
 *
 * Idempotente: usa generarCuentasCobroPeriodo con service role client.
 * Si ya existe cuenta para (workspace, año, mes, empresa) la salta.
 *
 * Uso:
 *   cd metrik-one
 *   npx tsx scripts/generar-cuentas-mayo-metrik.ts
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const WS_METRIK_ID = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
const ANIO = 2026
const MES = 5
const IS_DRAFT = true

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

async function main() {
  const sb = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!)

  const { generarCuentasCobroPeriodo } = await import('../src/lib/cobros/generar-cuentas-cobro')

  console.log(`▶ Generando cuentas de cobro ${ANIO}-${String(MES).padStart(2, '0')} — workspace metrik`)
  console.log(`  isDraft: ${IS_DRAFT}\n`)

  const result = await generarCuentasCobroPeriodo(
    sb as never,
    WS_METRIK_ID,
    ANIO,
    MES,
    { isDraft: IS_DRAFT },
  )

  console.log(`\n✓ Cuentas creadas: ${result.cuentasCreadas}`)
  console.log(`✓ Cuentas omitidas (ya existian): ${result.cuentasOmitidas}`)
  console.log(`✗ Errores: ${result.errores.length}`)

  if (result.errores.length > 0) {
    console.log('\nErrores:')
    for (const e of result.errores) {
      console.log(`  - ${e.empresa_id}: ${e.error}`)
    }
  }

  console.log('\nDetalles:')
  for (const d of result.detalles) {
    const monto = d.monto_total.toLocaleString('es-CO')
    console.log(`  [${d.estado.toUpperCase()}] ${d.numero ?? '???'} — ${d.empresa_nombre} — $${monto}`)
    if (d.pdf_drive_url) console.log(`    PDF: ${d.pdf_drive_url}`)
  }
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
