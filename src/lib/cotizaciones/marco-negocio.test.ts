import { describe, expect, it } from 'vitest'

import {
  cotizacionesAbiertas,
  encabezadoDelMarco,
  fechaCortaBogota,
  iataDelDestino,
  muestraCotizaciones,
  perfilDesdeCustomData,
  solicitudDesdeFilas,
} from './marco-negocio'
import type { LineaParaCobertura } from './cobertura-opciones'

function vuelo(id: string, destino: string, origen = 'Bogotá (BOG)'): LineaParaCobertura {
  return {
    id,
    grupo: 'vuelo',
    opcion_de: null,
    es_ajuste: false,
    orden: 0,
    tarifa_pax: {
      casillas: {
        grupo_completo: {
          moneda: 'COP', total: 1, aPagarAgencia: null, porTipo: [],
          ocupacion: { adultos: null, ninos: null, infantes: null, total: null },
          ocupacionDelItem: false,
          identidad: { origen, destino, fecha_salida: '2026-11-09', fecha_regreso: '2026-11-13' },
          notasCliente: [], alertas: [], campos: [], nombre: 'x', descripcion: '', leidaEn: '2026-09-23T00:00:00Z',
        },
      },
    },
  }
}

describe('iataDelDestino', () => {
  it('toma el código del vuelo que llega a la ciudad del destino, sin tildes ni mayúsculas', () => {
    expect(iataDelDestino('san andres', [vuelo('a', 'San Andrés (ADZ)')])).toBe('ADZ')
    expect(iataDelDestino('Orlando', [vuelo('a', 'Orlando MCO')])).toBe('MCO')
  })

  it('un vuelo a otra ciudad no le da código al destino (Providencia vía San Andrés)', () => {
    expect(iataDelDestino('Providencia', [vuelo('a', 'San Andrés (ADZ)')])).toBeNull()
  })

  it('el regreso no cuenta: llega al origen, no al destino', () => {
    expect(iataDelDestino('Bogotá', [vuelo('a', 'San Andrés (ADZ)', 'Bogotá (BOG)')])).toBeNull()
  })

  it('sin vuelos o sin destino, sin código', () => {
    expect(iataDelDestino('Cartagena', [])).toBeNull()
    expect(iataDelDestino(null, [vuelo('a', 'Cartagena (CTG)')])).toBeNull()
  })
})

describe('encabezadoDelMarco', () => {
  const viaje = {
    destino: 'San Andrés',
    fechas: { inicio: '2026-11-09', fin: '2026-11-13' },
    composicion: { adultos: 2, ninos: 1, infantes: 0 },
  }

  it('pone el IATA junto al destino cuando lo hay', () => {
    const e = encabezadoDelMarco(viaje, 'ADZ')
    expect(e.resumen.startsWith('San Andrés · ADZ · 9 al 13 nov 2026')).toBe(true)
    expect(e.motivo).toBeNull()
  })

  it('sin IATA, el nombre solo', () => {
    expect(encabezadoDelMarco(viaje, null).resumen.startsWith('San Andrés · 9 al 13 nov 2026')).toBe(true)
  })

  it('conserva el ámbar de P9 cuando faltan fechas', () => {
    const e = encabezadoDelMarco({ ...viaje, fechas: { inicio: null, fin: null } }, 'ADZ')
    expect(e.motivo).toBe('Faltan las fechas del viaje en el negocio')
  })
})

describe('perfilDesdeCustomData', () => {
  it('traduce las opciones y deja fuera el documento y la autorización', () => {
    const p = perfilDesdeCustomData({
      tipo_cliente: 'leisure',
      rango_presupuesto: 'medio',
      con_quien_viaja: 'ESPOSA E HIJO',
      preferencias: 'TODO INCLUIDO',
      notas_perfil: 'Viajes tranquilos',
      documento_identidad: '1016044186',
      autorizacion_datos: true,
    })
    expect(p).toEqual({
      tipo: 'Leisure',
      conQuienViaja: 'ESPOSA E HIJO',
      bolsillo: 'Medio',
      preferencias: 'TODO INCLUIDO',
      notas: 'Viajes tranquilos',
    })
    expect(JSON.stringify(p)).not.toContain('1016044186')
  })

  it('«sin declarar» no es un bolsillo', () => {
    expect(perfilDesdeCustomData({ rango_presupuesto: 'sin declarar', tipo_cliente: 'corporativo' })?.bolsillo).toBeNull()
  })

  it('sin perfil devuelve null', () => {
    expect(perfilDesdeCustomData({})).toBeNull()
    expect(perfilDesdeCustomData(null)).toBeNull()
    expect(perfilDesdeCustomData({ documento_identidad: '1' })).toBeNull()
  })
})

describe('solicitudDesdeFilas', () => {
  it('arma la solicitud con el alcance, el tipo de fechas y los requisitos', () => {
    const viaje = { destino: 'Miami', fechas: { inicio: '2026-12-01', fin: '2026-12-08' }, composicion: { adultos: 2, ninos: 0, infantes: 0 } }
    const s = solicitudDesdeFilas([{}, { destino_tipo: 'internacional', fechas_tipo: 'moviles', requisitos_especiales: 'Cuna' }], viaje)
    expect(s).toEqual({
      destino: 'Miami',
      alcance: 'Internacional',
      fechas: '1 al 8 dic 2026',
      tipoDeFechas: 'fechas móviles',
      pasajeros: '2 adultos',
      requisitos: 'Cuna',
    })
  })
})

describe('cotizacionesAbiertas', () => {
  it('lista borrador, enviada y aceptada; deja fuera rechazada y vencida; la última editada primero', () => {
    const filas = [
      { id: '1', codigo: 'COT-1', estado: 'borrador', valor_total: 100, updated_at: '2026-09-20T10:00:00Z' },
      { id: '2', codigo: 'COT-2', estado: 'rechazada', valor_total: 100, updated_at: '2026-09-23T10:00:00Z' },
      { id: '3', codigo: 'COT-3', estado: 'enviada', valor_total: 200, updated_at: '2026-09-22T10:00:00Z' },
      { id: '4', codigo: 'COT-4', estado: 'vencida', valor_total: 100, updated_at: '2026-09-21T10:00:00Z' },
      { id: '5', codigo: null, consecutivo: 'COT-5', estado: 'aceptada', valor_total: null, updated_at: '2026-09-19T10:00:00Z' },
    ]
    expect(cotizacionesAbiertas(filas).map(c => c.codigo)).toEqual(['COT-3', 'COT-1', 'COT-5'])
  })
})

describe('muestraCotizaciones', () => {
  it('solo en las etapas 2 y 3', () => {
    expect(muestraCotizaciones({ nombre: 'Solicitud', stage: 'venta', numero: 1 })).toBe(false)
    expect(muestraCotizaciones({ nombre: 'Cotización', stage: 'venta', numero: 2 })).toBe(true)
    expect(muestraCotizaciones({ nombre: 'Seguimiento', stage: 'venta', numero: 3 })).toBe(true)
    expect(muestraCotizaciones({ nombre: 'Confirmación', stage: 'venta', numero: 4 })).toBe(false)
    expect(muestraCotizaciones(null)).toBe(false)
  })
})

describe('fechaCortaBogota', () => {
  it('usa la hora de Bogotá: las 2 a.m. UTC del 24 son el 23', () => {
    expect(fechaCortaBogota('2026-09-24T02:00:00Z')).toBe('23 sep')
    expect(fechaCortaBogota(null)).toBeNull()
  })
})
