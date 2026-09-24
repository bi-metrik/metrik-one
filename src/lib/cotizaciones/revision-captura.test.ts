import { describe, expect, it } from 'vitest'

import fixture from './providencia-equipaje.fixture.json'
import { ranuraPorSlug } from './ranuras-pantallazo'
import type { LecturaCasilla } from './tarifa-pasajero'
import {
  PREGUNTA_HORA_LLEGADA,
  camposDeRevision,
  correccionesDeRevision,
  preguntaDeRevision,
  tituloDeCaptura,
} from './revision-captura'

const LECTURAS = fixture as unknown as Record<string, Record<string, string | null>>

function lectura(slugRanura: string, valores: Record<string, string | null>, extra: Partial<LecturaCasilla> = {}): LecturaCasilla {
  const ranura = ranuraPorSlug(slugRanura)!
  const campos = ranura.campos
    .filter(c => valores[c.slug] !== null && valores[c.slug] !== undefined)
    .map(c => ({ label: c.label, valor: valores[c.slug] as string }))
  return {
    moneda: 'COP', total: Number(valores.precio_total ?? 0), aPagarAgencia: null, porTipo: [],
    ocupacion: {
      adultos: valores.ocupacion_adultos ? Number(valores.ocupacion_adultos) : null,
      ninos: valores.ocupacion_ninos ? Number(valores.ocupacion_ninos) : null,
      infantes: valores.ocupacion_infantes ? Number(valores.ocupacion_infantes) : null,
      total: null,
    },
    ocupacionDelItem: false, identidad: {}, notasCliente: [], alertas: [], campos,
    nombre: '', descripcion: '', leidaEn: '2026-09-24T00:00:00Z',
    ...extra,
  } as LecturaCasilla
}

const AVIANCA = lectura('vuelo_detalle', LECTURAS['01-vuelo1-bog-adz-avianca.png'])
const SIN_LLEGADA = lectura('vuelo_detalle', { ...LECTURAS['01-vuelo1-bog-adz-avianca.png'], hora_llegada: null })

describe('la fila de un vuelo', () => {
  it('título: aerolínea y ruta con los nombres de las ciudades', () => {
    expect(tituloDeCaptura('vuelo', AVIANCA)).toBe('Avianca · Bogotá → San Andrés')
  })

  it('campos del prototipo, con los rótulos por aeropuerto y el costo sin tocar', () => {
    const c = camposDeRevision('vuelo', AVIANCA)
    expect(c.map(x => x.label)).toEqual(['Aerolínea', 'Vuelo', 'Fecha', 'Sale de BOG', 'Llega a ADZ', 'Costo'])
    expect(c.find(x => x.slug === 'fecha_salida')?.valor).toBe('9 nov 2026')
    expect(c.find(x => x.slug === 'costo')).toMatchObject({ valor: '2.184.600', editable: false })
    expect(c.every(x => !x.dudoso)).toBe(true)
    expect(preguntaDeRevision('vuelo', c)).toBeNull()
  })

  it('sin hora de llegada: el campo en ámbar con «Escríbela» y la pregunta del prototipo', () => {
    const c = camposDeRevision('vuelo', SIN_LLEGADA)
    expect(c.find(x => x.slug === 'hora_llegada')).toMatchObject({ valor: '', dudoso: true, placeholder: 'Escríbela' })
    expect(preguntaDeRevision('vuelo', c)).toBe(PREGUNTA_HORA_LLEGADA)
  })
})

describe('la fila de un hotel', () => {
  const hotel = lectura('hotel_detalle', {
    hotel: 'Posada Enilda', tipo_habitacion: 'Habitación 2 Camas', check_in: '2026-11-23', check_out: '--11-25/mie',
    ocupacion_adultos: '2', moneda: 'COP', precio_total: '401200',
  })

  it('título con habitación y ocupación, y con el precio en la pregunta de la habitación que sobra', () => {
    expect(tituloDeCaptura('hotel', hotel)).toBe('Posada Enilda · Habitación 2 Camas · 2 adultos')
    expect(tituloDeCaptura('hotel', hotel, true)).toBe('Posada Enilda · Habitación 2 Camas · 2 adultos · $401.200')
  })

  it('una fecha sin año se lee sin inventarlo', () => {
    expect(camposDeRevision('hotel', hotel).find(x => x.slug === 'check_out')?.valor).toBe('25 nov')
  })
})

describe('lo que viaja con «Aceptar con cambios»', () => {
  const campos = camposDeRevision('vuelo', SIN_LLEGADA)

  it('solo lo que la persona cambió, normalizado como lo guarda la lectura', () => {
    const r = correccionesDeRevision('vuelo', campos, {
      hora_llegada: '7:40 pm',
      fecha_salida: '10 nov 2026',
      aerolinea: 'Avianca',
    })
    expect(r).toEqual({ ok: true, correcciones: [
      { slug: 'fecha_salida', valor: '2026-11-10' },
      { slug: 'hora_llegada', valor: '19:40' },
    ] })
  })

  it('el costo no viaja aunque llegue escrito', () => {
    const r = correccionesDeRevision('vuelo', campos, { costo: '1' })
    expect(r).toEqual({ ok: true, correcciones: [] })
  })

  it('un campo vaciado a propósito viaja vacío', () => {
    const r = correccionesDeRevision('vuelo', campos, { numero_vuelo: '' })
    expect(r).toEqual({ ok: true, correcciones: [{ slug: 'numero_vuelo', valor: '' }] })
  })

  it('lo que no se puede guardar se dice por campo y no viaja nada', () => {
    const r = correccionesDeRevision('vuelo', campos, { hora_llegada: 'tarde', fecha_salida: '31 feb' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errores.hora_llegada).toContain('07:45')
    expect(r.errores.fecha_salida).toBe('La fecha no es válida.')
  })
})
