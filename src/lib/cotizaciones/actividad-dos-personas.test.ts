import { describe, expect, it } from 'vitest'

import {
  capturasDesactualizadas,
  resolverTarifa,
  validarLecturaEnCasilla,
  type Composicion,
  type LecturaCasilla,
} from './tarifa-pasajero'

/**
 * Brief del 2026-10-05, punto 7: un pantallazo de actividad que dice «2 personas» en un viaje
 * de 2 adultos y 1 infante se rechazaba (TP3). Con la decisión del 2026-10-01 (el infante va
 * gratis en la actividad), 2 personas son los que pagan: se acepta y se reparte entre los 2
 * adultos, infante $0.
 */
const GRUPO: Composicion = { adultos: 2, ninos: 0, infantes: 1 }

function lectura(ocupacion: LecturaCasilla['ocupacion'], over: Partial<LecturaCasilla> = {}): LecturaCasilla {
  return {
    total: 300_000, moneda: 'COP', aPagarAgencia: null, porTipo: [],
    ocupacion, ocupacionDelItem: false,
    identidad: { nombre: 'Snorkel en Crab Cay', fecha: '2026-11-11' }, notasCliente: [], alertas: [],
    campos: [], nombre: 'Snorkel en Crab Cay', descripcion: '', leidaEn: '2026-10-05T12:00:00Z',
    paraComposicion: GRUPO,
    ...over,
  }
}

const DOS = { adultos: null, ninos: null, infantes: null, total: 2 }

describe('actividad «2 personas» en un viaje 2A+1I (punto 7)', () => {
  it('se acepta, y el aviso dice que son los que pagan', () => {
    const v = validarLecturaEnCasilla({ clave: 'grupo_completo', lectura: lectura(DOS), composicion: GRUPO, casillas: {}, ranuraSlug: 'actividad_detalle' })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.alertas).toEqual(['El pantallazo dice 2 personas: son 2 adultos. El infante no paga en la actividad.'])
  })

  it('también «2 adultos» separado por tipo', () => {
    const l = lectura({ adultos: 2, ninos: 0, infantes: 0, total: 2 })
    expect(validarLecturaEnCasilla({ clave: 'grupo_completo', lectura: l, composicion: GRUPO, casillas: {}, ranuraSlug: 'actividad_detalle' }).ok).toBe(true)
  })

  it('se reparte entre los 2 adultos: 150.000 cada uno, infante $0', () => {
    const e = resolverTarifa(GRUPO, { grupo_completo: lectura(DOS) }, 'actividad_detalle')
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.costos.map(c => [c.tipo, c.cantidad, c.unitario])).toEqual([['adulto', 2, 150_000], ['infante', 1, 0]])
    expect(e.costoTotal).toBe(300_000)
  })

  it('sin la marca de para quién se buscó, la captura de los que pagan no queda vieja', () => {
    const l = lectura({ adultos: 2, ninos: 0, infantes: 0, total: 2 }, { paraComposicion: undefined })
    expect(capturasDesactualizadas(GRUPO, { grupo_completo: l }, 'actividad_detalle')).toEqual([])
  })

  it('lo que no cambia: 1 persona sigue rechazada, y un hotel con 2 personas también', () => {
    const una = { adultos: null, ninos: null, infantes: null, total: 1 }
    const r = validarLecturaEnCasilla({ clave: 'grupo_completo', lectura: lectura(una), composicion: GRUPO, casillas: {}, ranuraSlug: 'actividad_detalle' })
    expect(r.ok).toBe(false)
    const hotel = validarLecturaEnCasilla({ clave: 'grupo_completo', lectura: lectura(DOS), composicion: GRUPO, casillas: {}, ranuraSlug: 'hotel_detalle' })
    expect(hotel.ok).toBe(false)
    // Con un niño en el viaje el reparto no está decidido: «2 personas» sigue sin entrar.
    const conNino = validarLecturaEnCasilla({ clave: 'grupo_completo', lectura: lectura(DOS), composicion: { adultos: 2, ninos: 1, infantes: 0 }, casillas: {}, ranuraSlug: 'actividad_detalle' })
    expect(conNino.ok).toBe(false)
  })
})
