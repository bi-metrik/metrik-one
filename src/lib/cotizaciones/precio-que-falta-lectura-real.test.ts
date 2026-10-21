/**
 * H1 · P12 · V4 (verificación D de Vera, 2026-10-14): el precio del niño que falta, con la
 * `tarifa_pax` que de verdad guarda la lectura de un pantallazo de solo adultos.
 *
 * Las pruebas de C5 pasaban porque su lectura traía la composición del VIAJE (6/1/1). La lectura
 * real de un pantallazo de SATENA con «Adulto · 6 · COP 470.314» guarda la del PANTALLAZO: la
 * línea queda con `composicion` 6/0/0, y con ella `tiposSinPrecio` creía que no faltaba nada, la
 * bandeja ofrecía «Reemplazar el precio» en vez de «Completa SATENA: precio del niño», y la
 * opción cobraba solo a los 6 adultos de un viaje de 8.
 */
import { describe, expect, it } from 'vitest'

import { completaDe, destinoDeReglas, fraseDeDestino } from './destino-por-pasos'
import {
  conPasajerosDelViaje,
  motivoSinPrecioPorPasajero,
  opcionesSinPrecio,
  textoCortoDeOpcion,
  tiposSinPrecio,
} from './precio-que-falta'
import { revisarBorrador } from './revisar-borrador'
import { composicionDeLinea, leerTarifaPax, resolverTarifa, type LecturaCasilla } from './tarifa-pasajero'
import { leer, SATENA } from '../../../test/caso-once-pantallazos'

const VIAJE = { adultos: 6, ninos: 1, infantes: 1 }
const GRUPO_SATENA = 'vuelo 2: Vuelo San Andrés ⇄ Providencia'

/** La lectura como la deja un pantallazo (no «✎ a mano»): sin `origen` y con los menores «no se ven». */
function comoPantallazo(l: LecturaCasilla, cambios: Partial<LecturaCasilla>): LecturaCasilla {
  const { origen: _o, sinPrecio: _s, ...resto } = l as LecturaCasilla & { origen?: string }
  void _o
  void _s
  return { ...resto, ...cambios }
}

/** «Adulto · 6 · COP 470.314 · Total COP 2.821.884» (pantallazo v4b de Vera). */
const SATENA_6_ADULTOS = comoPantallazo(
  leer({ ...SATENA, datos: { ...SATENA.datos, adultos: 6, ninos: 0, infantes: 0, netoAdulto: 470_314, netoNino: null, netoInfante: null } }),
  {
    total: 2_821_884,
    porTipo: [{ tipo: 'adulto', cantidad: 6, subtotal: 2_821_884 }],
    ocupacion: { adultos: 6, ninos: null, infantes: null, total: null },
    paraComposicion: { adultos: 6, ninos: 0, infantes: 0 },
  },
)

/** La `tarifa_pax` que guarda `guardarLecturaEnItem` + `confirmarTarifaPorPasajero` con esa lectura. */
const TARIFA_REAL = {
  composicion: { adultos: 6, ninos: 0, infantes: 0 },
  casillas: { grupo_completo: SATENA_6_ADULTOS },
  confirmada: {
    composicion: { adultos: 6, ninos: 0, infantes: 0 },
    costos: [{ tipo: 'adulto', cantidad: 6, unitarioCOP: 470_314, totalCOP: 2_821_884 }],
    costoTotalCOP: 2_821_884, moneda: 'COP', tasa: null, confirmadaEn: '2026-10-14T15:00:00.000Z',
  },
}

const LINEA_REAL = { id: 'item-satena', nombre: 'SATENA', grupo: GRUPO_SATENA, tarifa_pax: TARIFA_REAL }

/** «Adulto · 6 · 470.314 / Niño · 1 · 470.312 · Total 3.292.196» (pantallazo v4b-nino de Vera). */
const SATENA_CON_NINO = comoPantallazo(
  leer({ ...SATENA, datos: { ...SATENA.datos, adultos: 6, ninos: 1, infantes: 0, netoAdulto: 470_314, netoNino: 470_312, netoInfante: null } }),
  {
    total: 3_292_196,
    porTipo: [{ tipo: 'adulto', cantidad: 6, subtotal: 2_821_884 }, { tipo: 'nino', cantidad: 1, subtotal: 470_312 }],
    ocupacion: { adultos: 6, ninos: 1, infantes: null, total: null },
  },
)

describe('H1 · la tarifa_pax real de un pantallazo de solo adultos', () => {
  it('es la que dijo Vera: la línea queda con la composición del pantallazo (6/0/0)', () => {
    expect(composicionDeLinea(leerTarifaPax(TARIFA_REAL), VIAJE)).toEqual({ adultos: 6, ninos: 0, infantes: 0 })
  })

  it('le falta el precio del niño y el del infante del viaje', () => {
    expect(tiposSinPrecio(LINEA_REAL, VIAJE)).toEqual(['nino', 'infante'])
  })

  it('impide enviar, con el motivo del servidor', () => {
    const op = opcionesSinPrecio([LINEA_REAL], new Set([LINEA_REAL.id]), VIAJE)
    expect(op).toEqual([{ id: 'item-satena', nombre: 'SATENA', tipos: ['nino', 'infante'] }])
    expect(motivoSinPrecioPorPasajero(op)).toMatch(/SATENA \(niño e infante\)/)
  })

  it('el pantallazo con el niño sale como «Completa SATENA: precio del niño»', () => {
    const c = completaDe('vuelo', SATENA_CON_NINO, [LINEA_REAL], VIAJE)
    expect(c).toMatchObject({ itemId: 'item-satena', tipos: ['nino'], precios: { nino: 470_312 } })
    const d = destinoDeReglas({ tipo: 'vuelo', lectura: SATENA_CON_NINO, pistas: { lugar: null, origen: null, destino: null }, lineas: [LINEA_REAL], grupoViaje: VIAJE })
    expect(fraseDeDestino(d, 'Vuelo', [LINEA_REAL])).toBe('Completa SATENA: precio del niño')
  })

  it('la bandeja por pasos no lo pregunta como «el precio cambió: reemplázalo»', () => {
    const args = {
      capId: 'cap-nino',
      borrador: { tipo: 'vuelo' as const, lectura: SATENA_CON_NINO, pistas: { lugar: null, origen: 'San Andrés', destino: 'Providencia' } },
      lineas: [LINEA_REAL],
      comparables: [LINEA_REAL],
      composicion: VIAJE,
      ubicaciones: { 'item-satena': { bloque: 'Vuelo 2', opcion: 1 } },
      comparar: true,
    }
    // Con la pantalla de siempre la pregunta sigue igual (byte a byte).
    expect(revisarBorrador(args as never).pregunta).toMatchObject({ fase: 'otro_precio' })
    expect(revisarBorrador({ ...args, porPasos: true } as never).pregunta).toBeUndefined()
  })

  it('con el precio que trae ese pantallazo, el costo cubre a los 8 y no a los 6', () => {
    const t = conPasajerosDelViaje(leerTarifaPax(TARIFA_REAL), VIAJE, 'vuelo_detalle')
    const c = composicionDeLinea(t, VIAJE)
    expect(c).toEqual(VIAJE)
    const e = resolverTarifa(c!, t.casillas ?? {}, 'vuelo_detalle', { aMano: { nino: 470_312, infante: 0 } })
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.costoTotal).toBe(2_821_884 + 470_312)
    expect(e.costos.map(x => [x.tipo, x.cantidad])).toEqual([['adulto', 6], ['nino', 1], ['infante', 1]])
  })

  it('una actividad para menos pasajeros (el buceo de 2 adultos) no cambia: es decisión de quien cotiza', () => {
    const buceo = { id: 'b', nombre: 'Buceo', grupo: 'actividad: Actividad en San Andrés', tarifa_pax: { ...TARIFA_REAL, casillas: { grupo_completo: { ...SATENA_6_ADULTOS, porTipo: [{ tipo: 'adulto', cantidad: 2, subtotal: 1_080_000 }] } }, composicion: { adultos: 2, ninos: 0, infantes: 0 } } }
    expect(tiposSinPrecio(buceo, VIAJE)).toEqual([])
    expect(conPasajerosDelViaje(leerTarifaPax(buceo.tarifa_pax), VIAJE, 'actividad_detalle')).toEqual(leerTarifaPax(buceo.tarifa_pax))
  })

  it('una composición que no salió del pantallazo (la escribió una persona) se respeta', () => {
    const aMano = { ...TARIFA_REAL, composicion: { adultos: 5, ninos: 0, infantes: 0 } }
    const t = leerTarifaPax(aMano)
    expect(conPasajerosDelViaje(t, VIAJE, 'vuelo_detalle')).toEqual(t)
  })
})

describe('H1 · un pantallazo sin conteo de pasajeros no se toma por 1 adulto en silencio', () => {
  /** «Valor por adulto: COP 470.314», sin cantidad: la lectura lo toma como 1 adulto. */
  const UNO = comoPantallazo(SATENA_6_ADULTOS, {
    total: 470_314,
    porTipo: [{ tipo: 'adulto', cantidad: 1, subtotal: 470_314 }],
    ocupacion: { adultos: null, ninos: null, infantes: null, total: null },
    paraComposicion: { adultos: 1, ninos: 0, infantes: 0 },
  })
  const linea = {
    id: 'item-uno', nombre: 'SATENA', grupo: GRUPO_SATENA,
    tarifa_pax: { composicion: { adultos: 1, ninos: 0, infantes: 0 }, casillas: { grupo_completo: UNO } },
  }

  it('impide enviar y dice a cuántos cubre contra cuántos viajan', () => {
    const op = opcionesSinPrecio([linea], new Set([linea.id]), VIAJE)
    expect(op).toHaveLength(1)
    expect(op[0].adultosCubiertos).toBe(1)
    const motivo = motivoSinPrecioPorPasajero(op)!
    expect(motivo).toMatch(/SATENA trae el precio de 1 adulto y en el viaje van 6/)
  })

  it('la tarjeta y «Lo que suma» lo dicen corto', () => {
    expect(textoCortoDeOpcion(linea, VIAJE)).toBe('Cubre 1 de 6 adultos · Falta precio: niño, infante')
  })
})
