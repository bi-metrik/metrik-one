/**
 * QA de Trappvel, ronda 3, grupo G10 (2026-10-30) · bloqueo: el operador por paquete.
 *
 *  · H-13: con dos operadores («ALIADOS TRAVEL / TU RESERVA») cada paquete tiene el SUYO, ligado a su
 *    ficha si está en el Directorio, y el servicio hereda el de ESE paquete.
 *  · M-07: el servicio del paquete se rotula «Paquete» (derivado, sin migración).
 *  · H-17: la «Compra antes del» del paquete llega al plan de pagos y a `fecha_limite_pago`.
 *
 * Los datos son los de la reprueba (`bitacora-reprueba-bloqueo.md`) y del viaje 05 (Iberostar, Tu
 * Reserva, «compra antes del 15/12/2026», costo 9.458.000, total 11.127.059).
 */
import { describe, expect, it } from 'vitest'

import ghl from './__fixtures__/bloqueo/tureserva-ghl-tres-columnas.json'
import { hotelDesdeLectura } from './bloqueo-extraccion'
import {
  esOperadorMezclado,
  fichaDelOperador,
  operadorAlGuardar,
  operadorDeLaLectura,
  operadorInicialDelPaquete,
  operadoresDeLaSolicitud,
  proveedorDelPaquete,
} from './bloqueo-operador'
import { avisosDelPaquete, paqueteVacio, type PaqueteBloqueo } from './bloqueo-paquete'
import { filasDeServicioDeTarifa, lecturaDelServicio, type ItemParaServicio } from '@/lib/viaje/servicios-desde-tarifa'
import { etiquetaTipoServicio } from '@/lib/viaje/etiqueta-servicio'
import { lineasDeValidacion, planSugerido, validarPlan, type HitoProveedor } from '@/lib/viaje/plan-pagos'
import { hitosDeProveedor } from '@/lib/viaje/hitos-proveedor'

const MEZCLA = 'ALIADOS TRAVEL / TU RESERVA'
const GRUPO = 'paquete de bloqueo: Paquete de bloqueo en San Andrés'
const PARAMS = { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' as const }

function paquete(operador: string | null, compraAntesDe: string | null = null): PaqueteBloqueo {
  const p = paqueteVacio(operador)
  p.hotel.hotel = 'Decameron Isleño'
  p.hotel.noches = 5
  p.hotel.compraAntesDe = compraAntesDe
  p.hotel.precios = [{ acomodacion: 'doble', precioPorPersona: 2_812_900 }]
  p.distribucion = { habitaciones: { doble: 1 }, ninos: 0, infantes: 0, edadesNinos: [] }
  return p
}
const item = (id: string, p: PaqueteBloqueo, subtotal = 5_625_800): ItemParaServicio => ({
  id, nombre: (p.hotel.hotel ?? 'PAQUETE').toUpperCase(), grupo: GRUPO, opcion_de: null, es_ajuste: false, orden: 1,
  dia_relativo: null, entra_al_precio: null, cantidad: 1, subtotal, numeroDeRubros: 0,
  costoDeRubros: 0, descuento_porcentaje: 0, margen_porcentaje: null, precio_venta: Math.round(subtotal / 0.85),
  precio_manual: false, adicionales: [], pasajeros: null, tarifa_pax: { bloqueo: p }, tramos: null,
})

describe('H-13 · el texto de la solicitud con dos operadores', () => {
  it('se parte en sus operadores («/» de la reprueba y « Y » del viaje 02)', () => {
    expect(operadoresDeLaSolicitud(MEZCLA)).toEqual(['ALIADOS TRAVEL', 'TU RESERVA'])
    expect(operadoresDeLaSolicitud('ALIADOS TRAVEL Y TU RESERVA')).toEqual(['ALIADOS TRAVEL', 'TU RESERVA'])
    expect(operadoresDeLaSolicitud('TU RESERVA')).toEqual(['TU RESERVA'])
    expect(operadoresDeLaSolicitud('  ')).toEqual([])
    expect(esOperadorMezclado(MEZCLA)).toBe(true)
    expect(esOperadorMezclado('Aliados Travel')).toBe(false)
  })

  it('un paquete nuevo nace con el único operador; con dos, sin operador', () => {
    expect(operadorInicialDelPaquete('TU RESERVA')).toBe('TU RESERVA')
    expect(operadorInicialDelPaquete(MEZCLA)).toBeNull()
    expect(operadorInicialDelPaquete(null)).toBeNull()
  })

  it('al guardar: el del paquete manda; la mezcla nunca se guarda', () => {
    expect(operadorAlGuardar('TU RESERVA', MEZCLA)).toBe('TU RESERVA')
    expect(operadorAlGuardar(null, MEZCLA)).toBeNull()
    expect(operadorAlGuardar(MEZCLA, MEZCLA)).toBeNull()
    expect(operadorAlGuardar(null, 'Aliados Travel')).toBe('Aliados Travel')
    expect(operadorAlGuardar(MEZCLA, 'Aliados Travel')).toBe('Aliados Travel')
  })

  it('el operador leído del pantallazo vale si es uno de la solicitud', () => {
    expect(operadorDeLaLectura('Tu Reserva', ['ALIADOS TRAVEL', 'TU RESERVA'])).toBe('TU RESERVA')
    expect(operadorDeLaLectura('Decameron', ['ALIADOS TRAVEL', 'TU RESERVA'])).toBeNull()
    expect(operadorDeLaLectura('Aliados', ['ALIADOS TRAVEL', 'TU RESERVA'])).toBe('ALIADOS TRAVEL')
    expect(operadorDeLaLectura('Tu Reserva', [])).toBe('Tu Reserva')
    expect(operadorDeLaLectura(null, ['TU RESERVA'])).toBeNull()
  })

  it('el lector del hotel devuelve el operador que se ve en la pantalla', () => {
    const h = hotelDesdeLectura({ ...ghl, operador: 'Tu Reserva' })
    expect(h.ok && h.operador).toBe('Tu Reserva')
    const sin = hotelDesdeLectura(ghl)
    expect(sin.ok && sin.operador).toBeNull()
  })

  it('la ficha del Directorio: por nombre, una sola; no la de un hotel homónimo si hay la de operador', () => {
    const fichas = [
      { id: 'f-aliados', nombre: 'Aliados Travel', tipo_proveedor: 'operador' },
      { id: 'f-otro', nombre: 'Aliados Travel', tipo_proveedor: 'otro' },
      { id: 'f-ghl', nombre: 'GHL Hoteles', tipo_proveedor: 'otro' },
    ]
    expect(fichaDelOperador('ALIADOS TRAVEL', fichas)?.id).toBe('f-aliados')
    expect(fichaDelOperador('Aliados Travel S.A.S.', [fichas[0]])?.id).toBe('f-aliados')
    expect(fichaDelOperador('TU RESERVA', fichas)).toBeNull()
    expect(fichaDelOperador(MEZCLA, fichas)).toBeNull()
    expect(fichaDelOperador('Aliados', [fichas[0]])?.id).toBe('f-aliados')
  })

  it('la ficha de la línea: la del operador; la de otro proveedor se suelta; la de un hotel se conserva', () => {
    const fichas = [{ id: 'f-aliados', nombre: 'Aliados Travel', tipo_proveedor: 'operador' }]
    expect(proveedorDelPaquete({ ficha: fichas[0], previa: null, fichas })).toBe('f-aliados')
    expect(proveedorDelPaquete({ ficha: null, previa: 'f-aliados', fichas })).toBeNull()
    expect(proveedorDelPaquete({ ficha: null, previa: 'ficha-hotel', fichas })).toBe('ficha-hotel')
  })

  it('con dos operadores, el paquete sin el suyo avisa (ámbar); con uno, no', () => {
    const sin = avisosDelPaquete(paquete(null), { hoy: '2026-10-30', pasajeros: null, operadorSolicitud: MEZCLA })
    expect(sin.find(a => a.clave === 'sin_operador')).toMatchObject({ nivel: 'ambar' })
    expect(sin.find(a => a.clave === 'sin_operador')?.texto).toMatch(/ALIADOS TRAVEL, TU RESERVA/)
    const mezclado = avisosDelPaquete(paquete(MEZCLA), { hoy: '2026-10-30', pasajeros: null, operadorSolicitud: MEZCLA })
    expect(mezclado.some(a => a.clave === 'sin_operador')).toBe(true)
    const elegido = avisosDelPaquete(paquete('TU RESERVA'), { hoy: '2026-10-30', pasajeros: null, operadorSolicitud: MEZCLA })
    expect(elegido.some(a => a.clave === 'sin_operador')).toBe(false)
    const uno = avisosDelPaquete(paquete(null), { hoy: '2026-10-30', pasajeros: null, operadorSolicitud: 'TU RESERVA' })
    expect(uno.some(a => a.clave === 'sin_operador')).toBe(false)
  })

  it('al confirmar, el servicio de cada paquete lleva el operador de ESE paquete', () => {
    // Cada paquete es una tarifa (D5): el cliente escoge una y nace el servicio de ESE paquete.
    const items = [item('pa', paquete('ALIADOS TRAVEL')), item('pb', { ...paquete('TU RESERVA'), hotel: { ...paquete(null).hotel, hotel: 'GHL Relax' } })]
    const servicio = (sel: string) => filasDeServicioDeTarifa({ items, seleccion: [sel], params: PARAMS, tipoRanuraPorItem: { pa: 'paquete', pb: 'paquete' } })
      .map(f => [f.nombre, f.proveedor_nombre, f.buscarEmpresa])
    expect(servicio('pa')).toEqual([['PAQUETE · DECAMERON ISLEÑO', 'ALIADOS TRAVEL', true]])
    expect(servicio('pb')).toEqual([['PAQUETE · GHL RELAX', 'TU RESERVA', true]])
  })

  it('un paquete viejo con el texto mezclado deja el servicio SIN proveedor («Falta el proveedor»), no con la mezcla', () => {
    expect(lecturaDelServicio(item('pa', paquete(MEZCLA)), 'otro').proveedor).toBeNull()
  })
})

describe('M-07 · el servicio del paquete se rotula «Paquete» (sin migración)', () => {
  it('«otro» que se llama «PAQUETE · …» es Paquete; lo demás, su tipo', () => {
    expect(etiquetaTipoServicio({ tipo: 'otro', nombre: 'PAQUETE · DECAMERON ISLEÑO' })).toBe('Paquete')
    expect(etiquetaTipoServicio({ tipo: 'otro', nombre: 'Tarjeta de turismo' })).toBe('Otro')
    expect(etiquetaTipoServicio({ tipo: 'vuelo', nombre: 'PAQUETE raro' })).toBe('Vuelo')
    expect(etiquetaTipoServicio({ tipo: 'tren', nombre: null })).toBe('Tren')
  })
})

describe('H-17 · la «Compra antes del» del paquete en el servicio y el plan de pagos (viaje 05)', () => {
  const HOY = '2026-10-29'
  const SALIDA = '2027-05-08'
  const TOTAL = 11_127_059
  const HITO: HitoProveedor = { fecha: '2026-12-15', monto: 9_458_000, operador: 'TU RESERVA' }

  it('el servicio nace con fecha_limite_pago = la «Compra antes del»', () => {
    const [f] = filasDeServicioDeTarifa({ items: [item('pq', paquete('TU RESERVA', '2026-12-15'))], seleccion: null, params: PARAMS, tipoRanuraPorItem: { pq: 'paquete' } })
    expect(f.fecha_limite_pago).toBe('2026-12-15')
    const [sin] = filasDeServicioDeTarifa({ items: [item('pq', paquete('TU RESERVA'))], seleccion: null, params: PARAMS, tipoRanuraPorItem: { pq: 'paquete' } })
    expect(sin.fecha_limite_pago).toBeUndefined()
  })

  it('los hitos de la tarifa salen de sus paquetes con fecha (y solo de los de esa tarifa)', () => {
    const items = [
      { ...item('pa', paquete('TU RESERVA', '2026-12-15'), 9_458_000) },
      { ...item('pb', paquete('ALIADOS TRAVEL', '2026-11-20'), 7_000_000) },
    ]
    expect(hitosDeProveedor(items, ['pa'])).toEqual([HITO])
    expect(hitosDeProveedor(items, null).map(h => h.fecha)).toEqual(['2026-11-20', '2026-12-15'])
    expect(hitosDeProveedor([item('pc', paquete(MEZCLA, '2026-12-15'), 1_000)], null)[0].operador).toBeNull()
  })

  it('el sugerido de siempre dejaba al 15 dic solo el anticipo; con el hito, al 15 dic el cliente cubre el paquete', () => {
    const antes = planSugerido({ total: TOTAL, fechaSalida: SALIDA, hoy: HOY })!
    const alHito = (c: { fecha: string; monto: number }[]) => c.filter(x => x.fecha <= HITO.fecha).reduce((s, x) => s + x.monto, 0)
    expect(alHito(antes)).toBe(3_338_000)

    const plan = planSugerido({ total: TOTAL, fechaSalida: SALIDA, hoy: HOY, hitos: [HITO] })!
    expect(plan.reduce((s, c) => s + c.monto, 0)).toBe(TOTAL)
    expect(alHito(plan)).toBe(9_458_000)
    expect(plan.find(c => c.fecha === HITO.fecha)?.concepto).toBe('Compra del paquete con TU RESERVA')
    const v = validarPlan(plan, { total: TOTAL, fechaSalida: SALIDA, hoy: HOY, hitos: [HITO] })
    expect(v.dentroDeRegla).toBe(true)
    expect(v.proveedor).toMatchObject({ cubierto: true, requerido: 9_458_000 })
  })

  it('un plan que no cubre el hito queda fuera de la regla y lo dice', () => {
    const plan = planSugerido({ total: TOTAL, fechaSalida: SALIDA, hoy: HOY })!
    const ctx = { total: TOTAL, fechaSalida: SALIDA, hoy: HOY, hitos: [HITO] }
    const v = validarPlan(plan, ctx)
    expect(v.dentroDeRegla).toBe(false)
    expect(v.proveedor).toMatchObject({ cubierto: false, acumulado: 3_338_000, requerido: 9_458_000 })
    const linea = lineasDeValidacion(v, ctx).find(l => /cobra el paquete/.test(l.texto))
    expect(linea).toMatchObject({ ok: false })
    expect(linea?.texto).toMatch(/TU RESERVA cobra el paquete antes del 15 dic/)
    // Sin hitos, el mismo plan sigue dentro de la regla: nada cambia para quien no los tiene.
    expect(validarPlan(plan, { total: TOTAL, fechaSalida: SALIDA, hoy: HOY }).dentroDeRegla).toBe(true)
  })

  it('un hito ya vencido no mueve el plan (el paquete ya avisa «ya pasó»)', () => {
    const vencido = { ...HITO, fecha: '2026-10-01' }
    expect(planSugerido({ total: TOTAL, fechaSalida: SALIDA, hoy: HOY, hitos: [vencido] })).toEqual(planSugerido({ total: TOTAL, fechaSalida: SALIDA, hoy: HOY }))
  })
})
