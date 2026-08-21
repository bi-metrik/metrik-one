/**
 * Emite las cuentas de cobro de UN periodo (anio + mes) para UN workspace.
 *
 * Cubre los DOS caminos, igual que el cron:
 *   - planes uniformes  → una cuenta agrupada por empresa, vencimiento dia 15
 *   - planes con cronograma explicito (`plan_cobro_cuotas`) → una cuenta por
 *     cuota, con el monto y el vencimiento exactos del contrato
 * Si el rescate solo corriera el primero, un cliente con cronograma explicito
 * (Trappvel) quedaria fuera aqui igual que quedaba fuera del cron.
 *
 * Reemplaza los scripts de un solo uso (`generar-cuentas-mayo-metrik.ts`,
 * `generar-cuentas-junio-metrik.ts`), que eran el mismo codigo con el mes
 * clavado. Un script por mes invita a copiar y pegar un tercero, y cada copia
 * es una oportunidad de que el periodo y la fecha de emision se desincronicen.
 *
 * Existe porque la emision vive dentro del cron
 * (`/api/crons/procesar-planes-cobro`, tras la guarda `if (diaHoy === 10)`):
 * si el cron no corre ese dia, el mes se queda sin facturar. Esta es la via de
 * rescate por terminal; el boton «Emitir período» de /cobros-recurrentes hace
 * lo mismo desde la app desplegada, que es la unica via cuando las credenciales
 * de render y Drive no se pueden bajar a local.
 *
 * Idempotente: `generarCuentasCobroPeriodo` salta la cuenta si ya existe para
 * (workspace, anio, mes, empresa). Correrlo dos veces no duplica nada.
 *
 * Las cuentas nacen en `emitida_pendiente_aprobacion`. Este script NO envia
 * nada al cliente: el envio lo aprueba una persona desde `/cobros-recurrentes`.
 *
 * Uso:
 *   cd metrik-one
 *   npx tsx scripts/emitir-cuentas-periodo.ts --anio 2026 --mes 8              # dry-run
 *   npx tsx scripts/emitir-cuentas-periodo.ts --anio 2026 --mes 8 --commit     # real
 *   npx tsx scripts/emitir-cuentas-periodo.ts --anio 2026 --mes 8 --ws afi
 *
 * Opciones:
 *   --anio <n>      Anio del periodo. Obligatorio.
 *   --mes <n>       Mes del periodo (1-12). Obligatorio.
 *   --ws <slug>     Slug del workspace. Default: metrik.
 *   --emision <dd>  Dia de emision de la cuenta. Default: 13 (dia de envio al
 *                   cliente; el vencimiento sigue siendo el 15).
 *   --commit        Escribe de verdad. Sin este flag es dry-run.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const DIA_EMISION_DEFAULT = 13

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function argNumero(nombre: string): number | undefined {
  const v = arg(nombre)
  if (v === undefined) return undefined
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : undefined
}

const ANIO = argNumero('anio')
const MES = argNumero('mes')
const WS_SLUG = arg('ws') ?? 'metrik'
const DIA_EMISION = argNumero('emision') ?? DIA_EMISION_DEFAULT
const COMMIT = process.argv.includes('--commit')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function abortar(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  abortar('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local')
}
if (ANIO === undefined || MES === undefined) {
  abortar('Faltan --anio y --mes. Ej: --anio 2026 --mes 8')
}
if (MES < 1 || MES > 12) abortar(`--mes fuera de rango: ${MES}`)
if (DIA_EMISION < 1 || DIA_EMISION > 28) abortar(`--emision fuera de rango: ${DIA_EMISION}`)

const periodo = `${ANIO}-${String(MES).padStart(2, '0')}`
const fechaEmision = `${periodo}-${String(DIA_EMISION).padStart(2, '0')}`

function formatCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

async function main() {
  const sb = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!)

  // El workspace se resuelve por slug y se comprueba el modulo ANTES de emitir:
  // emitir en un workspace que no tiene el modulo activo seria emitir a nombre
  // de un emisor que nadie declaro.
  const { data: ws, error: wsErr } = await sb
    .from('workspaces')
    .select('id, slug, name, modules')
    .eq('slug', WS_SLUG)
    .maybeSingle()

  if (wsErr) abortar(`Error leyendo el workspace: ${wsErr.message}`)
  if (!ws) abortar(`No existe workspace con slug "${WS_SLUG}"`)

  const modules = (ws as { modules: Record<string, boolean> | null }).modules
  if (!modules?.cobros_recurrentes) {
    abortar(`El workspace "${WS_SLUG}" no tiene modules.cobros_recurrentes activo`)
  }

  const wsId = (ws as { id: string }).id
  const { generarCuentasCobroPeriodo } = await import('../src/lib/cobros/generar-cuentas-cobro')
  const { emitirCuentasExplicitasPeriodo } = await import('../src/lib/cobros/emitir-cuota-explicita')
  const { offsetCorrelativoExplicitas } = await import('../src/lib/cobros/resumen-emision-periodo')

  console.log(`▶ Cuentas de cobro ${periodo} · workspace ${WS_SLUG}`)
  console.log(`  modo: ${COMMIT ? 'REAL (--commit)' : 'dry-run (no toca DB ni Drive)'}`)
  console.log(`  emision: ${fechaEmision} · vence: ${periodo}-15 (uniformes) / segun contrato (explicitas)\n`)

  // ── Planes uniformes: una cuenta agrupada por empresa ──────────────
  const result = await generarCuentasCobroPeriodo(sb as never, wsId, ANIO!, MES!, {
    dryRun: !COMMIT,
    isDraft: false,
    fechaEmisionOverride: fechaEmision,
  })

  let total = result.detalles
    .filter((d) => d.estado === 'creada')
    .reduce((s, d) => s + d.monto_total, 0)
  let hayCreadas = result.detalles.some((d) => d.estado === 'creada')

  console.log('· Planes uniformes (vencimiento dia 15)')
  console.log(`  creadas: ${result.cuentasCreadas} · omitidas (ya existian): ${result.cuentasOmitidas}`)
  for (const d of result.detalles) {
    console.log(`  · [${d.estado}] ${d.numero ?? '—'} · ${d.empresa_nombre} · ${formatCOP(d.monto_total)} · ${d.cobros_ids.length} cobro(s)`)
    if (d.pdf_drive_url) console.log(`      Drive: ${d.pdf_drive_url}`)
  }
  if (!result.detalles.length) console.log('  (ninguno en el periodo)')

  // ── Planes con cronograma explicito: una cuenta por cuota ──────────
  // El offset arranca donde quedo el dry-run de arriba: en dry-run nada se
  // inserta, asi que sin el las dos listas imprimirian el mismo correlativo.
  // La regla vive en `resumen-emision-periodo` porque el boton de
  // /cobros-recurrentes la necesita igual; copiada aqui se desincronizaria.
  const previewsUniformes = offsetCorrelativoExplicitas(result.detalles, !COMMIT)
  const explicitas = await emitirCuentasExplicitasPeriodo(sb as never, wsId, ANIO!, MES!, {
    dryRun: !COMMIT,
    isDraft: false,
    fechaEmisionOverride: fechaEmision,
    numeroOffset: previewsUniformes,
  })

  console.log('\n· Planes con cronograma explicito (plan_cobro_cuotas)')
  console.log(`  creadas: ${explicitas.cuentasCreadas} · omitidas (ya existian): ${explicitas.cuentasOmitidas}`)
  for (const d of explicitas.detalles) {
    if (!d.success) {
      console.log(`  · [error] cuota ${d.planCuotaId}: ${d.error}`)
      continue
    }
    console.log(
      `  · [${d.estado}] ${d.numero} · ${d.empresaNombre} · ${formatCOP(d.monto)}` +
        ` · cuota ${d.numeroCuota} · vence ${d.fechaVencimiento} · emision ${d.fechaEmision}`,
    )
    if (d.pdfUrl) console.log(`      Drive: ${d.pdfUrl}`)
    if (d.estado === 'creada' || d.estado === 'preview') {
      total += d.monto
      hayCreadas = true
    }
  }
  if (!explicitas.detalles.length) console.log('  (ninguna cuota vence en el periodo)')

  if (hayCreadas) console.log(`\n  total a emitir: ${formatCOP(total)}`)

  const errores = [
    ...result.errores.map((e) => `${e.empresa_id}: ${e.error}`),
    ...explicitas.errores.map((e) => `cuota ${e.plan_cuota_id}: ${e.error}`),
  ]
  if (errores.length) {
    console.log(`\n✗ errores (${errores.length}):`)
    for (const e of errores) console.log(`  - ${e}`)
    process.exitCode = 1
  }

  if (!COMMIT) {
    console.log('\n(dry-run: no se escribio nada. Repetir con --commit para emitir.)')
  } else {
    console.log('\nLas cuentas quedan en "emitida_pendiente_aprobacion".')
    console.log('El envio al cliente se aprueba a mano desde /cobros-recurrentes.')
  }
}

main().catch((e) => {
  console.error('✗ Error:', e instanceof Error ? e.message : e)
  process.exit(1)
})
