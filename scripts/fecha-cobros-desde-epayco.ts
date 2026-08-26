/**
 * Corrige `cobros.fecha` con la fecha REAL de la transacción en ePayco.
 *
 * Por qué existe:
 *   El cargue histórico de SOENA fechó los cobros con la columna del Sheet, no con la
 *   transacción. Para el segundo pago esa columna sí es una fecha de pago; para el abono
 *   es la fecha de la FILA del caso, que es un sustituto. Como `v_venta_mes_comercial`
 *   fecha la venta con el `min(cobros.fecha)` del negocio, un abono mal fechado mueve la
 *   venta de mes. La decisión de Mauricio del 2026-08-18 ya está tomada: **la venta la
 *   define la fecha del pago**, y ePayco es quien la tiene.
 *
 *   Es el mismo defecto que arregló `src/lib/epayco/fecha-transaccion.ts` para los pagos
 *   que entran por la app. Este script lo arregla hacia atrás, para los que entraron por
 *   cargue.
 *
 * Regla heredada de ese módulo: **nunca inventar la fecha**. Si ePayco no responde, si la
 * referencia no existe o si el crudo no se puede leer, el cobro se deja como está y sale
 * en el reporte. Ningún caso se corrige a medias y ninguno se corrige en silencio.
 *
 * Además del calce de fecha compara el MONTO. Una referencia digitada mal en el Sheet
 * puede existir en ePayco y pertenecer a otro pago: si el monto no coincide, no se toca y
 * se reporta, porque cambiarle la fecha a un cobro con la transacción equivocada es peor
 * que dejarlo con la fecha del Sheet.
 *
 * Uso:
 *   npx tsx scripts/fecha-cobros-desde-epayco.ts                      (dry-run, todo el WS)
 *   npx tsx scripts/fecha-cobros-desde-epayco.ts --notas 'lote agosto 2026'
 *   npx tsx scripts/fecha-cobros-desde-epayco.ts --solo V0338,V0351
 *   npx tsx scripts/fecha-cobros-desde-epayco.ts --notas 'lote agosto 2026' --aplicar
 *
 * Necesita EPAYCO_PUBLIC_KEY y EPAYCO_PRIVATE_KEY. No bajan al entorno local: este script
 * corre donde estén las llaves.
 */
import './_load-env'
import { writeFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getTransactionDetail } from '../src/lib/epayco'
import { fechaTransaccionBogota } from '../src/lib/epayco/fecha-transaccion'

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
/** ePayco tolera muy poca concurrencia y el token dura 20 min: de a uno, con pausa. */
const PAUSA_MS = 250
/** Diferencia de monto que se acepta como redondeo del Sheet. */
const TOLERANCIA_MONTO = 1

type CobroFila = {
  id: string
  fecha: string | null
  monto: number
  external_ref: string | null
  tipo_cobro: string | null
  split_json: { ref_total?: unknown; por_reparto?: unknown } | null
  negocios: { codigo: string | null } | null
}

type Resultado = {
  codigo: string
  cobro_id: string
  ref: string
  monto: number
  fecha_actual: string | null
  fecha_epayco: string | null
  estado: 'corrige' | 'ya_estaba' | 'sin_referencia' | 'no_responde' | 'fecha_ilegible' | 'monto_no_calza'
  detalle?: string
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

function arg(nombre: string): string | null {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

async function main() {
  const aplicar = process.argv.includes('--aplicar')
  const notas = arg('--notas')
  const solo = arg('--solo')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ) as unknown as SupabaseClient

  let q = supabase
    .from('cobros')
    .select('id, fecha, monto, external_ref, tipo_cobro, split_json, negocios!inner(codigo)')
    .eq('workspace_id', WS)
    .is('anulado_at', null)
    .order('fecha', { ascending: true })
  if (notas) q = q.like('notas', `%${notas}%`)

  const { data, error } = await q
  if (error) { console.error('No se pudieron leer los cobros:', error.message); process.exit(1) }

  let filas = (data ?? []) as unknown as CobroFila[]
  if (solo) filas = filas.filter((f) => solo.includes(f.negocios?.codigo ?? ''))

  console.log(`Fecha de cobros desde ePayco · ${filas.length} cobros · ${aplicar ? 'EN VIVO' : 'DRY-RUN (no escribe)'}`)
  if (notas) console.log(`  filtro de notas: "${notas}"`)
  if (solo) console.log(`  solo: ${solo.join(', ')}`)
  console.log('')

  const res: Resultado[] = []

  for (const f of filas) {
    const codigo = f.negocios?.codigo ?? '?'
    const base = { codigo, cobro_id: f.id, ref: f.external_ref ?? '', monto: Number(f.monto), fecha_actual: f.fecha }

    // Sin referencia no hay nada que consultar. Ej.: los abonos que en el Sheet dicen
    // "Davivienda" porque entraron por transferencia y nunca pasaron por ePayco.
    const refNum = Number(f.external_ref)
    if (!f.external_ref || !Number.isFinite(refNum) || refNum <= 0) {
      res.push({ ...base, fecha_epayco: null, estado: 'sin_referencia' })
      continue
    }

    let fechaEpayco: string | null = null
    let montoEpayco: number | null = null
    try {
      const tx = await getTransactionDetail(refNum)
      fechaEpayco = fechaTransaccionBogota(tx.transactionDate)
      montoEpayco = Number(tx.amount)
    } catch (e) {
      res.push({ ...base, fecha_epayco: null, estado: 'no_responde', detalle: (e as Error).message.slice(0, 120) })
      await dormir(PAUSA_MS)
      continue
    }
    await dormir(PAUSA_MS)

    if (!fechaEpayco) {
      res.push({ ...base, fecha_epayco: null, estado: 'fecha_ilegible' })
      continue
    }

    // El monto es la prueba de que la referencia es la del cobro y no la de otro pago.
    // ⚠️ Un cobro EN REPARTO vale una fracción de la transacción: ahí se compara contra
    // `split_json.ref_total`, que es lo que el reparto declara que sumó la referencia.
    // Compararlo contra `monto` marcaría como error justo los casos que están bien.
    const enReparto = f.split_json?.por_reparto === true
    const refTotal = Number(f.split_json?.ref_total)
    const esperado = enReparto && Number.isFinite(refTotal) && refTotal > 0 ? refTotal : Number(f.monto)
    if (montoEpayco != null && Math.abs(montoEpayco - esperado) > TOLERANCIA_MONTO) {
      res.push({
        ...base, fecha_epayco: fechaEpayco, estado: 'monto_no_calza',
        detalle: `ePayco $${montoEpayco.toLocaleString('es-CO')} vs ${enReparto ? 'total del reparto' : 'cobro'} $${esperado.toLocaleString('es-CO')}`,
      })
      continue
    }

    if (f.fecha === fechaEpayco) {
      res.push({ ...base, fecha_epayco: fechaEpayco, estado: 'ya_estaba' })
      continue
    }

    if (aplicar) {
      const { error: e2 } = await supabase.from('cobros').update({ fecha: fechaEpayco }).eq('id', f.id)
      if (e2) {
        res.push({ ...base, fecha_epayco: fechaEpayco, estado: 'no_responde', detalle: 'update: ' + e2.message })
        continue
      }
    }
    res.push({ ...base, fecha_epayco: fechaEpayco, estado: 'corrige' })
    console.log(`  ${codigo}  #${f.external_ref}  ${f.fecha} → ${fechaEpayco}  $${Number(f.monto).toLocaleString('es-CO')}`)
  }

  const cuenta = (e: Resultado['estado']) => res.filter((r) => r.estado === e).length
  const corrige = res.filter((r) => r.estado === 'corrige')
  const cambianDeMes = corrige.filter((r) => (r.fecha_actual ?? '').slice(0, 7) !== (r.fecha_epayco ?? '').slice(0, 7))

  console.log('')
  console.log(`${aplicar ? 'corregidos' : 'a corregir'}: ${corrige.length}   de los cuales cambian de MES: ${cambianDeMes.length}`)
  console.log(`ya estaban bien:  ${cuenta('ya_estaba')}`)
  console.log(`sin referencia:   ${cuenta('sin_referencia')}`)
  console.log(`no responde:      ${cuenta('no_responde')}`)
  console.log(`fecha ilegible:   ${cuenta('fecha_ilegible')}`)
  console.log(`monto no calza:   ${cuenta('monto_no_calza')}`)

  for (const r of cambianDeMes) {
    console.log(`  ⚠ ${r.codigo} cambia de mes: ${r.fecha_actual} → ${r.fecha_epayco}`)
  }
  for (const r of res.filter((x) => x.estado === 'monto_no_calza' || x.estado === 'no_responde')) {
    console.log(`  ✗ ${r.codigo} #${r.ref} ${r.estado}: ${r.detalle ?? ''}`)
  }

  const salida = `fecha-cobros-epayco-${aplicar ? 'aplicado' : 'dryrun'}.json`
  writeFileSync(salida, JSON.stringify(res, null, 2))
  console.log(`\nreporte: ${salida}`)
  if (!aplicar && corrige.length > 0) console.log('Nada se escribió. Vuelve a correr con --aplicar.')
}

main().catch((e) => { console.error(e); process.exit(1) })
