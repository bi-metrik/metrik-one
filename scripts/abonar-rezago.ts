/**
 * Abona a la factura el honorario de los pagos que quedaron sin abono (el rezago).
 *
 * Regla 6 del brief del 2026-09-22 («Tesorería solo emite recibos de la tarifa UPME»): los
 * pagos que entraron a negocios YA facturados antes de que el abono fuera automático no
 * tienen ningún disparo que los alcance. Este script los abona en lote con la MISMA
 * rutina del abono automático (`abonarPagosDelNegocio`).
 *
 * ⚠️ Con `--commit` EMITE documentos contables (RC-1 `DebtPayment`) en el Siigo real del
 * cliente. No se deshacen desde ONE. Se corre con autorización de Mauricio.
 *
 * SIMULA por defecto: sin `--commit` solo lee la base (no le habla a Siigo) y lista lo que
 * abonaría. Es IDEMPOTENTE: una segunda corrida no encuentra nada que abonar.
 *
 * Uso:
 *   npx tsx scripts/abonar-rezago.ts soena                       # simula
 *   npx tsx scripts/abonar-rezago.ts soena --commit              # abona
 *   npx tsx scripts/abonar-rezago.ts soena --negocio <uuid>      # simula un solo caso
 *   npx tsx scripts/abonar-rezago.ts soena --commit --por "Nombre de quien lo corre"
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const args = process.argv.slice(2)
const slug = args[0]
const commit = args.includes('--commit')
const valorDe = (flag: string): string | null => {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}
const soloNegocio = valorDe('--negocio')
const por = valorDe('--por') ?? 'Lote de rezago de abonos'

if (!slug || slug.startsWith('--')) {
  console.error('Uso: npx tsx scripts/abonar-rezago.ts <slug> [--commit] [--negocio <uuid>] [--por "<nombre>"]')
  process.exit(1)
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { abonarRezago } = await import('../src/lib/siigo/rezago-abonos')

  const one = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const { data: ws } = await one.from('workspaces').select('id').eq('slug', slug).single()
  if (!ws) { console.error(`Workspace "${slug}" no existe`); process.exit(1) }
  const wsId = (ws as { id: string }).id

  console.log(`\n${commit ? '⚠️  APLICANDO: se emiten abonos en Siigo' : 'Simulación (sin --commit no se emite nada ni se consulta Siigo)'}\n`)

  const r = await abonarRezago(wsId, {
    aplicar: commit,
    staffNombre: por,
    ...(soloNegocio ? { soloNegocios: [soloNegocio] } : {}),
  })

  console.log(`Rezago: ${r.candidatos.length} pagos en ${r.negocios} negocios · honorario ${fmt(r.valor)}\n`)
  for (const c of r.candidatos) {
    const ret = c.retencion > 0 ? `  ⚠️ retención ${fmt(c.retencion)}: quedará a mano` : ''
    console.log(`  ${(c.negocio_codigo ?? '—').padEnd(8)} ${c.fecha ?? '—'}  ${fmt(c.honorario).padStart(12)}  → ${c.factura}${ret}`)
  }

  if (!commit) {
    console.log('\nNada se emitió. Para abonar: agrega --commit.')
    return
  }

  console.log(`\nEmitidos: ${r.emitidos.length}`)
  for (const e of r.emitidos) console.log(`  ${e.numero}  ${fmt(e.valor)}  (cobro ${e.cobro_id})`)
  console.log(`A mano: ${r.a_mano.length}`)
  for (const m of r.a_mano) console.log(`  cobro ${m.cobro_id}: ${m.motivo} — ${m.detalle}`)
  console.log(`Fallidos: ${r.fallidos.length}`)
  for (const f of r.fallidos) console.log(`  cobro ${f.cobro_id}: ${f.motivo}`)
  if (r.fallidos.length > 0) {
    console.log('\nLos fallidos quedaron sin marca: volver a correr el lote los reintenta sin duplicar los que salieron.')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
