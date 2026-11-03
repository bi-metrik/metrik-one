/**
 * QA de Trappvel, ronda 3, grupo G14 (2026-11-03) · los tres hallazgos medios que quedaron tras #1379-#1381.
 *
 *  · M-1: «Así puedes pagar» (PDF y «Revisar y enviar») ignoraba la «Compra antes del» del paquete:
 *    decía 3 jun / 17 jun mientras el plan de confirmar daba 2.784.000 hoy / 5.104.000 30 nov /
 *    1.392.000 17 jun. Ahora es el MISMO `planSugerido` con los MISMOS hitos.
 *  · M-2: con la opción 2 (sin nombre propio) el mensaje decía «*Tarifa:* Tarifa» y el panel
 *    «Tarifa Tarifa · $9.280.000». Ahora va el hotel del paquete, o nada.
 *  · M-3: con el anticipo a medias el chequeo quedaba ✓, no había aviso y el avance a mano pasaba a
 *    Reservas y pagos. Ahora el gate dice «Faltan $1.284.000 del anticipo.» y frena (Omitir gate sigue).
 */
import { describe, expect, it } from 'vitest'

import { paqueteVacio, type PaqueteBloqueo } from '@/lib/cotizaciones/bloqueo-paquete'
import { TERMINOS_BASE_TRAPPVEL } from '@/lib/cotizaciones/__fixtures__/terminos-base-trappvel'
import { asiPuedesPagar } from './asi-puedes-pagar'
import { gatesConfirmacionPendientes, mensajeConfirmacion, seccionesDeTerminos, MENSAJES_GATE_CONFIRMACION } from './confirmacion'
import { hitosDeProveedor } from './hitos-proveedor'
import { lineaDeTarifaEnPanel, nombreUtilDeTarifa } from './nombre-tarifa'
import { planSugerido, REGLA_POR_DEFECTO, type HitoProveedor } from './plan-pagos'

const HOY = '2026-11-03'
const SALIDA = '2027-06-18'
const TOTAL = 9_280_000

function paquete(hotel: string | null, operador: string | null, compraAntesDe: string | null): PaqueteBloqueo {
  const p = paqueteVacio(operador)
  p.hotel.hotel = hotel
  p.hotel.noches = 5
  p.hotel.compraAntesDe = compraAntesDe
  p.hotel.precios = [{ acomodacion: 'doble', precioPorPersona: 3_944_000 }]
  p.distribucion = { habitaciones: { doble: 1 }, ninos: 0, infantes: 0, edadesNinos: [] }
  return p
}
const itemPaquete = (id: string, p: PaqueteBloqueo, subtotal: number) => ({ id, subtotal, tarifa_pax: { bloqueo: p }, es_ajuste: false })

describe('M-1 · «Así puedes pagar» usa la «Compra antes del» como el plan de confirmar', () => {
  const HITO: HitoProveedor = { fecha: '2026-11-30', monto: 7_888_000, operador: 'TU RESERVA' }
  const entrada = { fechaSalida: SALIDA, hoy: HOY, regla: REGLA_POR_DEFECTO }

  it('el plan de confirmar del QA: 2.784.000 hoy / 5.104.000 30 nov / 1.392.000 17 jun', () => {
    const plan = planSugerido({ total: TOTAL, fechaSalida: SALIDA, hoy: HOY, hitos: [HITO] })!
    expect(plan.map((c) => [c.fecha, c.monto])).toEqual([
      ['2026-11-03', 2_784_000],
      ['2026-11-30', 5_104_000],
      ['2027-06-17', 1_392_000],
    ])
  })

  it('la propuesta dice las MISMAS fechas y montos', () => {
    const r = asiPuedesPagar(TOTAL, { ...entrada, hitos: [HITO] })
    expect(r.filas?.map((f) => [f.monto, f.cuando])).toEqual([
      [2_784_000, 'al confirmar (anticipo)'],
      [5_104_000, 'hasta el 30 de noviembre'],
      [1_392_000, 'hasta el 17 de junio, un día antes del viaje'],
    ])
    expect(r.suma).toBe(TOTAL)
    const plan = planSugerido({ total: TOTAL, fechaSalida: SALIDA, hoy: HOY, hitos: [HITO] })!
    expect(r.filas?.map((f) => f.monto)).toEqual(plan.map((c) => c.monto))
  })

  it('sin hitos, lo de siempre (30 % hoy, completar el 80 % a T-15, el resto el día antes)', () => {
    const r = asiPuedesPagar(TOTAL, entrada)
    expect(r.filas?.map((f) => f.cuando)).toEqual(['al confirmar (anticipo)', 'hasta el 3 de junio', 'hasta el 17 de junio, un día antes del viaje'])
  })

  it('con dos paquetes de operadores distintos, cada alternativa usa SU fecha', () => {
    const items = [
      itemPaquete('pa', paquete('Decameron Isleño', 'ALIADOS TRAVEL', '2026-12-15'), 7_000_000),
      itemPaquete('pb', paquete('GHL Relax', 'TU RESERVA', '2026-11-30'), 7_888_000),
    ]
    const hitosA = hitosDeProveedor(items, ['pa'])
    const hitosB = hitosDeProveedor(items, ['pb'])
    const a = asiPuedesPagar(TOTAL, { ...entrada, hitos: hitosA })
    const b = asiPuedesPagar(TOTAL, { ...entrada, hitos: hitosB })
    expect(a.filas?.[1].cuando).toBe('hasta el 15 de diciembre')
    expect(b.filas?.[1].cuando).toBe('hasta el 30 de noviembre')
    // El tercer argumento manda sobre los hitos de la entrada (la alternativa no principal).
    expect(asiPuedesPagar(TOTAL, { ...entrada, hitos: hitosA }, hitosB).filas).toEqual(b.filas)
  })
})

describe('M-2 · la opción sin nombre propio no se llama «Tarifa»', () => {
  const items = [
    itemPaquete('pa', paquete('Decameron Isleño', 'ALIADOS TRAVEL', null), 7_000_000),
    itemPaquete('pb', paquete('GHL Relax', 'TU RESERVA', null), 7_888_000),
    { id: 'vuelo', subtotal: 1_000_000, tarifa_pax: null, es_ajuste: false },
  ]

  it('el nombre propio de la tarifa manda; sin él, el hotel del paquete; sin paquete, nada', () => {
    expect(nombreUtilDeTarifa('Recomendada', items, ['pa'])).toBe('Recomendada')
    expect(nombreUtilDeTarifa(null, items, ['pb'])).toBe('GHL Relax')
    expect(nombreUtilDeTarifa('  ', items, ['pb', 'vuelo'])).toBe('GHL Relax')
    expect(nombreUtilDeTarifa('Tarifa', items, ['pb'])).toBe('GHL Relax')
    expect(nombreUtilDeTarifa('Opción 2', items, ['pb'])).toBe('GHL Relax')
    expect(nombreUtilDeTarifa(null, items, ['vuelo'])).toBeNull()
    expect(nombreUtilDeTarifa('tarifa', items, ['vuelo'])).toBeNull()
  })

  it('el mensaje al cliente nunca dice «*Tarifa:* Tarifa»: sin nombre útil, sin la línea', () => {
    const base = {
      nombreCliente: 'Carolina Duarte', destino: 'San Andrés', fechaSalida: SALIDA, fechaRegreso: null, composicion: null,
      total: TOTAL, cuotas: planSugerido({ total: TOTAL, fechaSalida: SALIDA, hoy: HOY })!, fechaMinimo: '2027-06-03', pctMinimo: 80,
      hoy: HOY, terminos: seccionesDeTerminos(TERMINOS_BASE_TRAPPVEL), extra: null, comercial: 'Daniela', agencia: 'Trappvel',
    }
    const generico = mensajeConfirmacion({ ...base, tarifaNombre: 'Tarifa' })
    expect(generico).not.toContain('*Tarifa:*')
    expect(mensajeConfirmacion({ ...base, tarifaNombre: 'GHL Relax' })).toContain('*Tarifa:* GHL Relax')
  })

  it('el panel: «Tarifa GHL Relax», nunca «Tarifa Tarifa»; sin nombre útil, nada', () => {
    expect(lineaDeTarifaEnPanel('GHL Relax')).toBe('Tarifa GHL Relax')
    expect(lineaDeTarifaEnPanel('Tarifa')).toBeNull()
    expect(lineaDeTarifaEnPanel(null)).toBeNull()
    expect(lineaDeTarifaEnPanel('Tarifa económica')).toBe('Tarifa económica')
  })
})

describe('M-3 · el anticipo a medias no deja Confirmación en verde', () => {
  const gates = ['confirmacion_registrada', 'plan_pagos_acordado', 'anticipo_con_soporte']

  it('con pago parcial con soporte: «Faltan $1.284.000 del anticipo.»', () => {
    const p = gatesConfirmacionPendientes(gates, { confirmado: true, planVigente: true, anticipoConSoporte: true, anticipoFalta: 1_284_000 })
    expect(p).toEqual(['Faltan $1.284.000 del anticipo.'])
  })

  it('completo: nada pendiente; sin ningún pago: el mensaje de siempre', () => {
    expect(gatesConfirmacionPendientes(gates, { confirmado: true, planVigente: true, anticipoConSoporte: true, anticipoFalta: 0 })).toEqual([])
    expect(gatesConfirmacionPendientes(gates, { confirmado: true, planVigente: true, anticipoConSoporte: false, anticipoFalta: 2_784_000 }))
      .toEqual([MENSAJES_GATE_CONFIRMACION.anticipo_con_soporte])
  })

  it('una etapa que no pide el anticipo no frena por él', () => {
    expect(gatesConfirmacionPendientes(['confirmacion_registrada'], { confirmado: true, planVigente: true, anticipoConSoporte: true, anticipoFalta: 1_284_000 })).toEqual([])
  })
})
