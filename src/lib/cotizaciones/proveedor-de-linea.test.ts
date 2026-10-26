/**
 * Qué hotel o tour nombra una línea, y si su nombre lo escribió una persona (brief del 2026-10-20,
 * punto 2: un servicio escrito a mano no es un proveedor). Datos ficticios.
 */
import { describe, expect, it } from 'vitest'

import { lecturaManual } from './ingreso-manual'
import { lineaEscritaAMano, pedidoDeLinea } from './proveedor-de-linea'
import { ranuraPorSlug } from './ranuras-pantallazo'

const actividadAMano = () => {
  const r = lecturaManual({
    ranura: ranuraPorSlug('actividad_detalle')!,
    entrada: { tipo: 'actividad', datos: { nombre: 'City Tour Ficticio', ciudad: 'Santa Marta', fecha: '2027-11-15', adultos: 2, ninos: 0, infantes: 0, netoAdulto: 105000, netoNino: null, netoInfante: null, opcional: false, fuente: '' } },
    leidaEn: '2026-10-20T10:00:00Z',
    hoy: '2026-10-20',
    fuenteOpcional: true,
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  return r.lectura
}

describe('pedidoDeLinea', () => {
  it('la actividad escrita a mano se marca aMano', () => {
    const item = { nombre: 'CITY TOUR FICTICIO', grupo: 'actividad', tarifa_pax: { casillas: { grupo_completo: actividadAMano() } } }
    expect(lineaEscritaAMano(item)).toBe(true)
    expect(pedidoDeLinea(item)).toMatchObject({ tipo: 'actividad', aMano: true })
  })

  it('la leída de un pantallazo no', () => {
    const l = { ...actividadAMano(), origen: undefined }
    const item = { nombre: 'CITY TOUR FICTICIO', grupo: 'actividad', tarifa_pax: { casillas: { grupo_completo: l } } }
    expect(pedidoDeLinea(item)).toMatchObject({ tipo: 'actividad', aMano: false })
  })

  it('después de elegir una tarifa del tarifario deja de ser «a mano»', () => {
    const l = { ...actividadAMano(), origen: 'tarifario' as const }
    expect(lineaEscritaAMano({ tarifa_pax: { casillas: { grupo_completo: l } } })).toBe(false)
  })
})
