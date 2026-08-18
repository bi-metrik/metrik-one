/**
 * Backfill: la fecha de un cobro de ePayco pasa a ser la del PAGO, no la del registro.
 *
 * Contexto (PR #312): `registrarPagoEpayco` guardaba `cobros.fecha = todayBogotaISO()`,
 * el dia en que alguien concilia. Como `v_venta_mes_comercial.fecha_venta` es el
 * `min(cobros.fecha)` del negocio, ese campo decide en que MES cae la venta en el
 * tablero comercial. El fix corrige los cobros nuevos; este script corrige los viejos.
 *
 * La fecha real solo la tiene ePayco. Se recupera consultando cada `ref_payco`
 * (guardado en `cobros.external_ref`) contra su API, y se convierte al dia civil de
 * Bogota con el MISMO modulo que usa el producto (`fechaTransaccionBogota`): si el
 * script tuviera su propia conversion, el historico y lo nuevo quedarian en dos
 * criterios distintos, que es justo lo que este backfill viene a cerrar.
 *
 * ⚠️ Esto MUEVE EL MES de ventas ya reportadas. Por eso:
 *   - Sin `--commit` es solo lectura y no escribe una sola fila.
 *   - El informe muestra, ademas del cambio por cobro, que negocios cambian su
 *     `fecha_venta` y a que mes se van. Esa es la cifra que hay que aprobar, no el
 *     conteo de filas tocadas.
 *   - Cada fila corregida deja rastro en `notas` con la fecha anterior. Un backfill
 *     sin rastro es inauditable e irreversible.
 *   - Un cobro ANULADO no se toca: su `monto` ya es 0 y su fecha es historia.
 *
 * Uso:
 *   npx tsx scripts/backfill-fecha-epayco.ts --ws soena            # informe, no escribe
 *   npx tsx scripts/backfill-fecha-epayco.ts --ws soena --commit   # aplica
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *           EPAYCO_PUBLIC_KEY, EPAYCO_PRIVATE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { consultarTransaccionEpayco } from '../src/lib/epayco'
import { fechaTransaccionBogota } from '../src/lib/epayco/fecha-transaccion'

const args = process.argv.slice(2)
const COMMIT = args.includes('--commit')
const WS_SLUG = args[args.indexOf('--ws') + 1]
// Pausa entre llamadas: la API de ePayco limita por rafaga y este barrido son ~100
// consultas seguidas. Ir despacio es gratis; que la mitad falle por limite, no.
const PAUSA_MS = Number(args[args.indexOf('--pausa') + 1]) || 350

if (!WS_SLUG || WS_SLUG.startsWith('--')) {
  console.error('Falta --ws <slug>')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(url, key) as any

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms))
const mes = (f: string) => f.slice(0, 7)

interface Fila {
  id: string
  negocio_id: string
  codigo: string | null
  external_ref: string
  fecha: string
  monto: number
  notas: string | null
}

async function main() {
  const { data: ws, error: wsErr } = await db
    .from('workspaces').select('id, slug').eq('slug', WS_SLUG).single()
  if (wsErr || !ws) throw new Error(`Workspace ${WS_SLUG} no encontrado: ${wsErr?.message}`)

  const { data: cobros, error } = await db
    .from('cobros')
    .select('id, negocio_id, external_ref, fecha, monto, notas, anulado_at, negocios!inner(codigo, workspace_id)')
    .eq('negocios.workspace_id', ws.id)
    .is('anulado_at', null)
    .not('external_ref', 'is', null)
  if (error) throw new Error(`Leyendo cobros: ${error.message}`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filas: Fila[] = (cobros as any[])
    .filter(c => /^[0-9]+$/.test(String(c.external_ref)))
    .map(c => ({
      id: c.id, negocio_id: c.negocio_id, codigo: c.negocios?.codigo ?? null,
      external_ref: String(c.external_ref), fecha: c.fecha,
      monto: Number(c.monto), notas: c.notas ?? null,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  console.log(`\n${filas.length} cobros con referencia ePayco en ${WS_SLUG} (anulados excluidos)`)
  console.log(COMMIT ? 'MODO: aplicar\n' : 'MODO: informe (no escribe)\n')

  const cambios: Array<Fila & { fechaReal: string }> = []
  const iguales: Fila[] = []
  const ilegibles: Array<Fila & { motivo: string }> = []

  for (const [i, f] of filas.entries()) {
    process.stdout.write(`\r  consultando ${i + 1}/${filas.length} …`)
    try {
      const desglose = await consultarTransaccionEpayco(Number(f.external_ref))
      const real = fechaTransaccionBogota(desglose.fecha)
      if (!real) {
        ilegibles.push({ ...f, motivo: `ePayco devolvio "${desglose.fecha}"` })
      } else if (real !== f.fecha) {
        cambios.push({ ...f, fechaReal: real })
      } else {
        iguales.push(f)
      }
    } catch (e) {
      ilegibles.push({ ...f, motivo: e instanceof Error ? e.message : String(e) })
    }
    await dormir(PAUSA_MS)
  }
  console.log('\n')

  // ── Impacto real: que negocios cambian el MES de su venta ────────────────────
  // El conteo de filas corregidas no es la cifra que importa. `fecha_venta` es el
  // minimo de las fechas del negocio, asi que un cobro puede moverse sin mover nada.
  const porNegocio = new Map<string, { codigo: string | null; antes: string[]; despues: string[] }>()
  for (const f of filas) {
    const e = porNegocio.get(f.negocio_id) ?? { codigo: f.codigo, antes: [], despues: [] }
    e.antes.push(f.fecha)
    const c = cambios.find(x => x.id === f.id)
    e.despues.push(c ? c.fechaReal : f.fecha)
    porNegocio.set(f.negocio_id, e)
  }
  const ventasMovidas = [...porNegocio.values()]
    .map(e => ({
      codigo: e.codigo,
      antes: e.antes.slice().sort()[0],
      despues: e.despues.slice().sort()[0],
    }))
    .filter(v => v.antes !== v.despues)

  console.log(`Sin cambio:   ${iguales.length}`)
  console.log(`A corregir:   ${cambios.length}`)
  console.log(`Ilegibles:    ${ilegibles.length}`)
  console.log(`\nNegocios que cambian la FECHA DE VENTA: ${ventasMovidas.length}`)
  const cambianDeMes = ventasMovidas.filter(v => mes(v.antes) !== mes(v.despues))
  console.log(`  …y de ellos cambian de MES: ${cambianDeMes.length}\n`)

  for (const v of ventasMovidas) {
    const marca = mes(v.antes) !== mes(v.despues) ? '  ⚠️ CAMBIA DE MES' : ''
    console.log(`  ${v.codigo ?? '(sin codigo)'}  ${v.antes} → ${v.despues}${marca}`)
  }

  if (cambios.length) {
    console.log('\nDetalle por cobro:')
    for (const c of cambios) {
      console.log(`  ${c.codigo ?? '?'}  ref ${c.external_ref}  ${c.fecha} → ${c.fechaReal}  $${c.monto.toLocaleString('es-CO')}`)
    }
  }
  if (ilegibles.length) {
    console.log('\n⚠️ No se pudo resolver (se dejan como estan):')
    for (const f of ilegibles) console.log(`  ${f.codigo ?? '?'}  ref ${f.external_ref}  ${f.motivo}`)
  }

  if (!COMMIT) {
    console.log('\nInforme. Nada escrito. Correr con --commit para aplicar.')
    return
  }

  console.log('\nAplicando…')
  let ok = 0
  for (const c of cambios) {
    const rastro = `[fecha corregida ${new Date().toISOString().slice(0, 10)}] registrada como ${c.fecha}; pago real en ePayco ${c.fechaReal} (ref ${c.external_ref})`
    const notas = c.notas ? `${c.notas}\n${rastro}` : rastro
    const { error: updErr } = await db
      .from('cobros').update({ fecha: c.fechaReal, notas }).eq('id', c.id)
    if (updErr) {
      console.error(`  ✗ ${c.codigo}: ${updErr.message}`)
    } else {
      ok++
    }
  }
  console.log(`\n${ok}/${cambios.length} cobros corregidos.`)
}

main().catch(e => { console.error('\n', e); process.exit(1) })
