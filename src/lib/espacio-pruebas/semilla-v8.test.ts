/**
 * Re-verificación D (Vera, condición 3): la semilla de V8 trae la Posada Enilda como TRES dobles
 * con su ocupación, una mal leída, y el espacio se resiembra limpio después de `--borrar`.
 */
import { describe, expect, it } from 'vitest'

import { ORIGEN, casoDeC0, crearAlmacenDoble } from '../../../test/espacio-pruebas-doble'
import type { Fila } from './almacen'
import { crearUsuarios, ejecutar, planificar, purgar, type OpcionesPlan, type Plan } from './plan'
import { SEMILLAS } from './semillas'
import { habitacionesDeTarifa, repartirHabitaciones } from '@/lib/cotizaciones/habitaciones'
import { resumenDeAlojamiento } from '@/lib/cotizaciones/tarjeta-opcion'
import { confirmacionDesactualizada, leerTarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'
import { lineasDesactualizadas } from '@/lib/cotizaciones/captura-desactualizada'

const CORREO = 'persona@metrik.example'
const VIAJE = { adultos: 6, ninos: 1, infantes: 1 }
const caso = casoDeC0()

function opciones(): OpcionesPlan {
  let n = 0
  return {
    origen: 'trappvel', destino: 'trappvel-pruebas', nombre: 'Viajes Prueba', correoBase: CORREO, incluirClaves: [],
    hoy: '2026-10-13', nuevoId: () => `bbbbbbbb-0000-4000-8000-${String(++n).padStart(12, '0')}`, caso,
  }
}

const filasDe = (plan: Plan, tabla: string): Fila[] =>
  plan.pasos.flatMap(p => (p.tipo === 'insertar' && p.tabla === tabla ? p.filas : p.tipo === 'guardar' && p.tabla === tabla ? [p.fila] : []))

function semilla(plan: Plan, clave: string) {
  const neg = filasDe(plan, 'negocios').find(n => (n.metadata as Record<string, unknown>).semilla_pruebas === clave)!
  const cot = filasDe(plan, 'cotizaciones').find(c => c.negocio_id === neg.id)!
  const items = filasDe(plan, 'items').filter(i => i.cotizacion_id === cot.id)
  return { neg, cot, items, posada: items.find(i => i.nombre === 'POSADA ENILDA · PROVIDENCIA')! }
}

async function aplicar(a: ReturnType<typeof crearAlmacenDoble>) {
  await crearUsuarios(a, CORREO, 'trappvel-pruebas')
  const plan = await planificar(a, opciones())
  await ejecutar(a, plan)
  return plan
}

describe('V8 · la Posada son tres dobles con su ocupación', () => {
  it('tres habitaciones con ocupación; la Doble 3 mal leída deja «falta 1 niño»', async () => {
    const plan = await planificar(crearAlmacenDoble(), opciones())
    const { posada } = semilla(plan, 'v8')
    const tarifa = leerTarifaPax(posada.tarifa_pax)
    const habs = habitacionesDeTarifa(tarifa)
    expect(habs).toHaveLength(3)
    const reparto = repartirHabitaciones(habs, VIAJE, tarifa.correcciones)
    expect(reparto.habitaciones.map(h => [h.tipoHabitacion, h.ocupacion, h.total])).toEqual([
      ['Doble', { adultos: 2, ninos: 0, infantes: 0 }, 409_699],
      ['Doble', { adultos: 2, ninos: 0, infantes: 1 }, 409_699],
      ['Doble', { adultos: 2, ninos: 0, infantes: 0 }, 409_700],
    ])
    const resumen = resumenDeAlojamiento(reparto)
    expect(resumen.titulo).toBe('3 habitaciones · falta 1 niño')
    // El costo confirmado casa con las habitaciones: ONE no pide volver a confirmarlo.
    expect(confirmacionDesactualizada(tarifa, tarifa.composicion ?? null)).toBeNull()
    expect(lineasDesactualizadas([{ ...posada, id: String(posada.id) }] as never, VIAJE)).toEqual([])
    expect(tarifa.confirmada?.costoTotalCOP).toBe(1_229_098)
  })

  it('cuesta lo mismo que la Posada de C0: la cotización de V8 abre con el total del caso fijo', async () => {
    const plan = await planificar(crearAlmacenDoble(), opciones())
    const fijo = semilla(plan, 'caso-fijo')
    const v8 = semilla(plan, 'v8')
    expect(v8.cot.valor_total).toBe(fijo.cot.valor_total)
    expect(v8.cot.costo_total).toBe(fijo.cot.costo_total)
    expect(v8.posada.precio_venta).toBe(fijo.posada.precio_venta)
    // Las demás semillas no cambian: la Posada del caso fijo sigue siendo una lectura.
    expect(leerTarifaPax(fijo.posada.tarifa_pax).habitaciones).toBeUndefined()
  })

  it('corregir la Doble 3 a 2 adultos y 1 niño la deja cubriendo a los 8', async () => {
    const plan = await planificar(crearAlmacenDoble(), opciones())
    const tarifa = leerTarifaPax(semilla(plan, 'v8').posada.tarifa_pax)
    const habs = habitacionesDeTarifa(tarifa).map(h => (h.id === 'hab-posada-doble-3'
      ? { ...h, correccion: { ocupacion: { adultos: 2, ninos: 1, infantes: 0 }, total: null, por: 'Asesora', porId: null, en: '2026-10-14T12:00:00.000Z' } }
      : h))
    const r = resumenDeAlojamiento(repartirHabitaciones(habs, VIAJE, tarifa.correcciones))
    expect(r.titulo).toBe('3 habitaciones · cubre a los 8 viajeros')
    expect(r.falta).toBeNull()
  })
})

describe('se resiembra limpio', () => {
  /** El estado del doble sin los ids que cambian de una corrida a otra (Auth y las filas sin id propio). */
  const foto = (a: ReturnType<typeof crearAlmacenDoble>) => {
    let json = JSON.stringify(a.estado)
    for (const u of a.usuarios as { id: string; correo: string }[]) json = json.split(u.id).join(`<auth:${u.correo}>`)
    // Las filas sin id propio reciben uno del doble (`fila-N`), que sigue contando entre corridas.
    // Lo mismo con las que crean los disparadores de la base al nacer el workspace (`ffffffff-…`).
    return json.replace(/"fila-\d+"/g, '"fila"').replace(/ffffffff-0000-4000-8000-\d{12}/g, 'disparador')
  }

  it('--borrar y otra corrida dejan el mismo espacio que la primera, aunque las pruebas lo hayan cambiado', async () => {
    const limpio = crearAlmacenDoble()
    await aplicar(limpio)

    const a = crearAlmacenDoble()
    const plan = await aplicar(a)
    // Lo que deja una prueba: una opción nueva, una línea de actividad y un negocio sembrado tocado.
    const { cot, neg } = semilla(plan, 'v8')
    a.estado.items.push({ id: 'cccccccc-0000-4000-8000-000000000101', cotizacion_id: cot.id })
    a.estado.activity_log.push({ id: 'cccccccc-0000-4000-8000-000000000102', workspace_id: plan.destino.id, entidad_id: neg.id, entidad_tipo: 'negocio' })
    a.estado.negocios.find(n => n.id === neg.id)!.nombre = 'tocado por la prueba'

    const inf = await purgar(a, { origen: 'trappvel', destino: 'trappvel-pruebas', correoBase: CORREO })
    expect(inf.pendientes).toEqual([])
    expect(inf.workspaceBorrado).toBe(true)
    await aplicar(a)
    expect(foto(a)).toBe(foto(limpio))
    expect(a.estado.negocios.filter(n => n.workspace_id !== ORIGEN.ws)).toHaveLength(SEMILLAS.length)
  })

  it('--resembrar no deja la actividad de los negocios borrados', async () => {
    const a = crearAlmacenDoble()
    const plan = await aplicar(a)
    const { neg, cot } = semilla(plan, 'v3')
    a.estado.activity_log.push(
      { id: 'cccccccc-0000-4000-8000-000000000201', workspace_id: plan.destino.id, entidad_id: neg.id, entidad_tipo: 'negocio' },
      { id: 'cccccccc-0000-4000-8000-000000000202', workspace_id: plan.destino.id, entidad_id: cot.id, entidad_tipo: 'cotizacion' },
      { id: 'cccccccc-0000-4000-8000-000000000203', workspace_id: plan.destino.id, entidad_id: 'dddddddd-0000-4000-8000-000000000001', entidad_tipo: 'negocio' },
    )
    const inf = await purgar(a, { origen: 'trappvel', destino: 'trappvel-pruebas', correoBase: CORREO, soloSemillas: true })
    expect(inf.residuo).toEqual({})
    // La de un negocio que no es semilla se queda.
    expect(a.estado.activity_log.filter(f => f.workspace_id === plan.destino.id).map(f => f.id)).toEqual(['cccccccc-0000-4000-8000-000000000203'])
  })
})
