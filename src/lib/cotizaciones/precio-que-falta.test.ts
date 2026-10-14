/**
 * C2 · el precio por pasajero que falta (regla del 2026-10-12, P12 de Vera): detectarlo y
 * cerrarlo a mano o con «No paga en este proveedor».
 */
import { describe, expect, it } from 'vitest'

import { preciosQueFaltan, resolverTarifa, type LecturaCasilla } from './tarifa-pasajero'
import { motivoSinPrecioPorPasajero, opcionesSinPrecio, textoCortoSinPrecio, textoLargoSinPrecio, tiposSinPrecio } from './precio-que-falta'

const GRUPO = { adultos: 6, ninos: 1, infantes: 1 }

function lectura(total: number, porTipo: LecturaCasilla['porTipo']): LecturaCasilla {
  return {
    moneda: 'COP', total, aPagarAgencia: null, porTipo,
    ocupacion: { adultos: 6, ninos: 1, infantes: 1, total: null }, ocupacionDelItem: false,
    identidad: {}, notasCliente: [], alertas: [], campos: [], nombre: 'SATENA', descripcion: '', leidaEn: '2026-10-12T00:00:00.000Z',
    paraComposicion: GRUPO,
  }
}
const SOLO_ADULTOS = { grupo_completo: lectura(2_682_000, [{ tipo: 'adulto', cantidad: 6, subtotal: 2_682_000 }]) }

describe('P12 · detectar el precio que falta', () => {
  it('un vuelo con solo el precio de los adultos: falta el del niño y el del infante', () => {
    expect(resolverTarifa(GRUPO, SOLO_ADULTOS, 'vuelo_detalle').estado).toBe('falta')
    expect(preciosQueFaltan(GRUPO, SOLO_ADULTOS, 'vuelo_detalle')).toEqual(['nino', 'infante'])
  })

  it('sin lo escrito a mano, resolverTarifa da exactamente lo de siempre', () => {
    const a = resolverTarifa(GRUPO, SOLO_ADULTOS, 'vuelo_detalle')
    const b = resolverTarifa(GRUPO, SOLO_ADULTOS, 'vuelo_detalle', { aMano: null })
    const c = resolverTarifa(GRUPO, SOLO_ADULTOS, 'vuelo_detalle', { aMano: {} })
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('un hotel o un traslado no entra en esta regla', () => {
    const linea = { grupo: 'hotel: Hotel en Providencia', tarifa_pax: { casillas: SOLO_ADULTOS } }
    expect(tiposSinPrecio(linea, GRUPO)).toEqual([])
    expect(tiposSinPrecio({ grupo: 'vuelo 2: SAI', tarifa_pax: { casillas: SOLO_ADULTOS } }, GRUPO)).toEqual(['nino', 'infante'])
  })

  it('con el costo ya confirmado por tipo, no falta nada', () => {
    const confirmada = {
      composicion: GRUPO, moneda: 'COP', tasa: null, confirmadaEn: 'x', costoTotalCOP: 1,
      costos: [{ tipo: 'adulto', cantidad: 6, unitarioCOP: 1, totalCOP: 6 }, { tipo: 'nino', cantidad: 1, unitarioCOP: 1, totalCOP: 1 }, { tipo: 'infante', cantidad: 1, unitarioCOP: 0, totalCOP: 0 }],
    }
    expect(tiposSinPrecio({ grupo: 'vuelo', tarifa_pax: { casillas: SOLO_ADULTOS, confirmada } }, GRUPO)).toEqual([])
  })
})

describe('P12 · cerrarlo a mano o con «No paga en este proveedor»', () => {
  it('niño escrito a mano e infante que no paga: queda resuelta, con el adulto del pantallazo', () => {
    const e = resolverTarifa(GRUPO, SOLO_ADULTOS, 'vuelo_detalle', { aMano: { nino: 447_000, infante: 0 } })
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.origen).toBe('a_mano')
    expect(e.costos.map(c => [c.tipo, c.unitario, c.total])).toEqual([['adulto', 447_000, 2_682_000], ['nino', 447_000, 447_000], ['infante', 0, 0]])
    expect(e.costos[2].deDonde).toMatch(/No paga en este proveedor/)
  })

  it('con un solo total para el grupo, el adulto sale de la resta', () => {
    const unTotal = { grupo_completo: lectura(3_292_196, []) }
    const e = resolverTarifa(GRUPO, unTotal, 'vuelo_detalle', { aMano: { nino: 447_000, infante: 163_196 } })
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.costos[0]).toMatchObject({ tipo: 'adulto', total: 2_682_000, unitario: 447_000 })
  })

  it('si falta uno de los dos menores, sigue faltando (y dice cuál)', () => {
    expect(resolverTarifa(GRUPO, SOLO_ADULTOS, 'vuelo_detalle', { aMano: { nino: 447_000 } }).estado).toBe('falta')
    expect(preciosQueFaltan(GRUPO, SOLO_ADULTOS, 'vuelo_detalle', { aMano: { nino: 447_000 } })).toEqual(['infante'])
  })

  it('lo escrito a mano que suma más que el total del pantallazo es inconsistente', () => {
    const unTotal = { grupo_completo: lectura(100_000, []) }
    expect(resolverTarifa(GRUPO, unTotal, 'vuelo_detalle', { aMano: { nino: 447_000, infante: 0 } }).estado).toBe('inconsistente')
  })

  it('una captura pegada para restar manda sobre lo escrito a mano', () => {
    const conSoloAdultos = { ...SOLO_ADULTOS, solo_adultos: lectura(2_682_000, []) }
    const e = resolverTarifa(GRUPO, conSoloAdultos, 'vuelo_detalle', { aMano: { nino: 1, infante: 1 } })
    expect(e.estado === 'resuelta' && e.origen).not.toBe('a_mano')
  })
})

describe('P12 · los textos', () => {
  it('nombra la opción y lo que falta', () => {
    const op = opcionesSinPrecio(
      [{ id: 'v', nombre: 'SATENA', grupo: 'vuelo 2', tarifa_pax: { casillas: SOLO_ADULTOS } }, { id: 'h', nombre: 'Hotel', grupo: 'hotel', tarifa_pax: null }],
      new Set(['v', 'h']),
      GRUPO,
    )
    expect(op).toEqual([{ id: 'v', nombre: 'SATENA', tipos: ['nino', 'infante'] }])
    expect(textoCortoSinPrecio(op[0].tipos)).toBe('Falta precio: niño, infante')
    expect(textoLargoSinPrecio('SATENA', op[0].tipos, { adultos: 6, ninos: 1, infantes: 0 })).toBe(
      'SATENA trae solo el precio del adulto: falta el de niño e infante. Busca otra vez la misma tarifa con 6 adultos y 1 niño y pégalo aquí o en la bandeja de arriba: ONE saca el precio que falta. Hasta tenerlo, no se puede enviar.',
    )
    expect(motivoSinPrecioPorPasajero(op)).toMatch(/^Falta el precio por pasajero de SATENA \(niño e infante\)/)
    expect(motivoSinPrecioPorPasajero([])).toBeNull()
  })

  it('una opción que no va al cliente no cuenta', () => {
    expect(opcionesSinPrecio([{ id: 'v', nombre: 'SATENA', grupo: 'vuelo', tarifa_pax: { casillas: SOLO_ADULTOS } }], new Set(), GRUPO)).toEqual([])
  })
})
