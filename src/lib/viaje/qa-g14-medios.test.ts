/**
 * QA de Trappvel, ronda 3, grupo G14 (2026-11-03) · los tres hallazgos medios que quedaron tras #1379-#1381.
 *
 *  · M-1: «Así puedes pagar» (PDF y «Revisar y enviar») ignoraba la «Compra antes del» del paquete:
 *    decía 3 jun / 17 jun mientras el plan de confirmar daba 2.784.000 hoy / 5.104.000 30 nov /
 *    1.392.000 17 jun. Ahora es el MISMO `planSugerido` con los MISMOS hitos.
 *  · M-2: con la opción 2 (sin nombre propio) el mensaje decía «*Tarifa:* Tarifa» y el panel
 *    «Tarifa Tarifa · $9.280.000». Ahora «*Opción elegida:*» con el hotel del paquete, o nada.
 *  · M-3: con el anticipo a medias el chequeo quedaba ✓ y no había aviso. Ahora el panel no pone ✓ y
 *    dice «Faltan $1.284.000 del anticipo.»; el avance a mano PASA (regla de Edgar, #1380, ratificada
 *    por Mauricio el 2026-11-03) pero lo avisa en el toast.
 */
import { describe, expect, it } from 'vitest'

import { paqueteVacio, type PaqueteBloqueo } from '@/lib/cotizaciones/bloqueo-paquete'
import { TERMINOS_BASE_TRAPPVEL } from '@/lib/cotizaciones/__fixtures__/terminos-base-trappvel'
import { asiPuedesPagar, notaDeFila } from './asi-puedes-pagar'
import { gatesConfirmacionPendientes, mensajeConfirmacion, seccionesDeTerminos, MENSAJES_GATE_CONFIRMACION, textoAvanceConAviso, textoFaltaAnticipo } from './confirmacion'
import { hitosDeProveedor } from './hitos-proveedor'
import { etiquetasDelSelector, lineaDeTarifaEnPanel, nombreUtilDeTarifa } from './nombre-tarifa'
import { nombreDeTarifaParaCliente } from '@/lib/cotizaciones/propuesta/modelo-documento'
import { pesos, planSugerido, REGLA_POR_DEFECTO, type HitoProveedor } from './plan-pagos'

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

  it('la nota de la fila no miente con la compra antes del: «con esto cubres el 80 % (llevas $7.888.000)»', () => {
    const r = asiPuedesPagar(TOTAL, { ...entrada, hitos: [HITO] })
    expect(r.filas!.map((f) => notaDeFila(f, r.pctMinimo, pesos))).toEqual([null, 'con esto cubres el 80 % (llevas $7.888.000)', null])
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

  it('el nombre propio lleva el léxico de marca, igual que la propuesta («Premium» → «Superior»)', () => {
    expect(nombreUtilDeTarifa('Premium', items, ['pa'])).toBe('Superior')
    expect(nombreUtilDeTarifa('PREMIUM', items, ['pa'])).toBe('SUPERIOR')
    expect(nombreDeTarifaParaCliente('Premium', false, 3)).toBe('Superior')
  })

  it('el selector del equipo distingue dos opciones con el mismo nombre; el del cliente no cambia', () => {
    expect(etiquetasDelSelector(['GHL Relax', 'GHL Relax', null])).toEqual(['GHL Relax · Opción 1', 'GHL Relax · Opción 2', 'Opción 3'])
    expect(etiquetasDelSelector(['Recomendada', 'GHL Relax'])).toEqual(['Recomendada', 'GHL Relax'])
  })

  it('el mensaje al cliente nunca dice «*Tarifa:* Tarifa»: sin nombre útil, sin la línea', () => {
    const base = {
      nombreCliente: 'Carolina Duarte', destino: 'San Andrés', fechaSalida: SALIDA, fechaRegreso: null, composicion: null,
      total: TOTAL, cuotas: planSugerido({ total: TOTAL, fechaSalida: SALIDA, hoy: HOY })!, fechaMinimo: '2027-06-03', pctMinimo: 80,
      hoy: HOY, terminos: seccionesDeTerminos(TERMINOS_BASE_TRAPPVEL), extra: null, comercial: 'Daniela', agencia: 'Trappvel',
    }
    const generico = mensajeConfirmacion({ ...base, tarifaNombre: 'Tarifa' })
    expect(generico).not.toContain('*Tarifa:*')
    expect(generico).not.toContain('*Opción elegida:*')
    expect(mensajeConfirmacion({ ...base, tarifaNombre: 'GHL Relax' })).toContain('*Opción elegida:* GHL Relax')
  })

  it('el panel: «Tarifa GHL Relax», nunca «Tarifa Tarifa»; sin nombre útil, nada', () => {
    expect(lineaDeTarifaEnPanel('GHL Relax')).toBe('Tarifa GHL Relax')
    expect(lineaDeTarifaEnPanel('Tarifa')).toBeNull()
    expect(lineaDeTarifaEnPanel(null)).toBeNull()
    expect(lineaDeTarifaEnPanel('Tarifa económica')).toBe('Tarifa económica')
  })
})

describe('M-3 · el anticipo a medias no deja Confirmación en verde, pero no frena (regla de Edgar)', () => {
  const gates = ['confirmacion_registrada', 'plan_pagos_acordado', 'anticipo_con_soporte']

  it('con pago parcial con soporte el gate se cumple (el avance a mano pasa) y lo que falta se avisa aparte', () => {
    expect(gatesConfirmacionPendientes(gates, { confirmado: true, planVigente: true, anticipoConSoporte: true, anticipoFalta: 1_284_000 })).toEqual([])
    expect(textoFaltaAnticipo(1_284_000)).toBe('Faltan $1.284.000 del anticipo.')
  })

  it('sin ningún pago: el mensaje de siempre', () => {
    expect(gatesConfirmacionPendientes(gates, { confirmado: true, planVigente: true, anticipoConSoporte: false, anticipoFalta: 2_784_000 }))
      .toEqual([MENSAJES_GATE_CONFIRMACION.anticipo_con_soporte])
  })

  it('el toast del avance a mano: «Avanzado a: Reservas y pagos. Faltan $1.284.000 del anticipo.»; sin aviso, el de siempre', () => {
    expect(textoAvanceConAviso('Avanzado a: Reservas y pagos', 'Faltan $1.284.000 del anticipo.')).toBe('Avanzado a: Reservas y pagos. Faltan $1.284.000 del anticipo.')
    expect(textoAvanceConAviso('Avanzado a: Reservas y pagos', null)).toBe('Avanzado a: Reservas y pagos')
  })
})
