import { describe, it, expect } from 'vitest'

import {
  avisosDeCobertura,
  coberturaDeLinea,
  textoDeTramo,
  type LineaParaCobertura,
} from './cobertura-opciones'
import type { LecturaCasilla } from './tarifa-pasajero'

const lectura = (identidad: Record<string, string | null>): LecturaCasilla => ({
  moneda: 'COP',
  total: 1000,
  aPagarAgencia: null,
  porTipo: [],
  ocupacion: { adultos: null, ninos: null, infantes: null, total: null },
  ocupacionDelItem: false,
  identidad,
  notasCliente: [],
  alertas: [],
  campos: [],
  nombre: 'Línea',
  descripcion: '',
  leidaEn: '2026-09-21T12:00:00Z',
})

/** Una línea de cotización con lo justo para la cobertura. */
function linea(id: string, extra: Partial<LineaParaCobertura> = {}): LineaParaCobertura {
  return {
    id,
    nombre: id,
    grupo: null,
    opcion_de: null,
    es_ajuste: false,
    orden: 0,
    ...extra,
  }
}

/** Una línea de vuelo con su captura ya leída. */
function vuelo(
  id: string,
  nombre: string,
  identidad: Record<string, string | null>,
  extra: Partial<LineaParaCobertura> = {},
): LineaParaCobertura {
  return linea(id, {
    nombre,
    grupo: 'vuelo',
    tarifa_pax: { casillas: { grupo_completo: lectura(identidad) } },
    ...extra,
  })
}

const AVIANCA = {
  origen: 'Bogotá',
  destino: 'San Andrés',
  fecha_salida: '2026-11-10',
  fecha_regreso: '2026-11-15',
}
const SATENA = {
  origen: 'San Andrés',
  destino: 'Providencia',
  fecha_salida: '2026-11-11',
  fecha_regreso: null,
}

// ── El caso de Alejandra ─────────────────────────────────────────────────────

describe('el caso que perdió el tramo', () => {
  it('avisa cuando dos opciones del mismo grupo no cubren lo mismo, nombrando qué cubre cada una', () => {
    const avisos = avisosDeCobertura([
      vuelo('a', 'AVIANCA', AVIANCA),
      vuelo('b', 'SATENA', SATENA, { opcion_de: 'a', orden: 1 }),
    ])
    expect(avisos).toHaveLength(1)
    expect(avisos[0].motivo).toBe('difieren')
    expect(avisos[0].grupo).toBe('vuelo')
    expect(avisos[0].texto).toContain('AVIANCA')
    expect(avisos[0].texto).toContain('Bogotá–San Andrés')
    expect(avisos[0].texto).toContain('San Andrés–Bogotá')
    expect(avisos[0].texto).toContain('SATENA')
    expect(avisos[0].texto).toContain('San Andrés–Providencia')
    // El apaño de §6 mientras 4.1 no exista: dónde va el tramo que falta.
    expect(avisos[0].texto).toContain('componente')
  })

  it('ninguna de las dos contiene a la otra: las dos coberturas viajan en el aviso', () => {
    const [aviso] = avisosDeCobertura([
      vuelo('a', 'AVIANCA', AVIANCA),
      vuelo('b', 'SATENA', SATENA, { opcion_de: 'a', orden: 1 }),
    ])
    expect(aviso.opciones.map(o => o.cubre)).toEqual([
      ['Bogotá–San Andrés', 'San Andrés–Bogotá'],
      ['San Andrés–Providencia'],
    ])
  })
})

// ── El aviso que NO tiene que salir ──────────────────────────────────────────

describe('un aviso que sale siempre no lo lee nadie', () => {
  it('dos opciones con el mismo origen y destino no producen aviso', () => {
    const avisos = avisosDeCobertura([
      vuelo('a', 'AVIANCA', AVIANCA),
      vuelo('b', 'LATAM', { ...AVIANCA, fecha_salida: '2026-11-10' }, { opcion_de: 'a', orden: 1 }),
    ])
    expect(avisos).toEqual([])
  })

  it('una sola opción en la ranura no produce aviso: no hay con qué comparar', () => {
    expect(avisosDeCobertura([vuelo('a', 'AVIANCA', AVIANCA)])).toEqual([])
  })

  it('una opción recién agregada, sin ninguna captura, no dispara el aviso en el mismo clic', () => {
    const avisos = avisosDeCobertura([
      vuelo('a', 'AVIANCA', AVIANCA),
      linea('b', { nombre: 'AVIANCA (alternativa)', grupo: 'vuelo', opcion_de: 'a', orden: 1 }),
    ])
    expect(avisos).toEqual([])
  })

  it('una cotización sin opciones no produce nada (R6)', () => {
    expect(avisosDeCobertura([linea('a', { grupo: 'vuelo' }), linea('b', { grupo: 'hotel' })])).toEqual([])
  })

  it('dos hoteles alternativos no producen aviso: su ranura no declara cobertura', () => {
    const conLectura = (id: string, hotel: string, extra: Partial<LineaParaCobertura> = {}) =>
      linea(id, {
        nombre: hotel,
        grupo: 'hotel',
        tarifa_pax: { casillas: { grupo_completo: lectura({ hotel, check_in: '2026-11-10', check_out: '2026-11-12' }) } },
        ...extra,
      })
    const avisos = avisosDeCobertura([
      conLectura('a', 'Decameron'),
      conLectura('b', 'Bahía Sardina', { opcion_de: 'a', orden: 1 }),
    ])
    expect(avisos).toEqual([])
  })
})

// ── Ida sin regreso ──────────────────────────────────────────────────────────

describe('ida y regreso', () => {
  it('una opción con ida y sin regreso frente a una con las dos: sale aviso', () => {
    const avisos = avisosDeCobertura([
      vuelo('a', 'AVIANCA', AVIANCA),
      vuelo('b', 'WINGO', { ...AVIANCA, fecha_regreso: null }, { opcion_de: 'a', orden: 1 }),
    ])
    expect(avisos).toHaveLength(1)
    expect(avisos[0].motivo).toBe('difieren')
    expect(avisos[0].opciones[1].cubre).toEqual(['Bogotá–San Andrés'])
  })

  it('las dos solo ida y con la misma ruta: sin aviso', () => {
    const soloIda = { ...AVIANCA, fecha_regreso: null }
    const avisos = avisosDeCobertura([
      vuelo('a', 'AVIANCA', soloIda),
      vuelo('b', 'WINGO', soloIda, { opcion_de: 'a', orden: 1 }),
    ])
    expect(avisos).toEqual([])
  })
})

// ── No inventa cobertura ─────────────────────────────────────────────────────

describe('no se afirma lo que no se leyó', () => {
  it('una línea con captura y sin origen ni destino legibles: el aviso dice que no pudo comparar', () => {
    const avisos = avisosDeCobertura([
      vuelo('a', 'AVIANCA', AVIANCA),
      vuelo('b', 'SATENA', { origen: null, destino: null, fecha_salida: null, fecha_regreso: null }, { opcion_de: 'a', orden: 1 }),
    ])
    expect(avisos).toHaveLength(1)
    expect(avisos[0].motivo).toBe('no_comparable')
    expect(avisos[0].texto).toContain('No se pudo comparar')
    expect(avisos[0].texto).toContain('SATENA')
    // Y NUNCA afirma que cubren lo mismo.
    expect(avisos[0].texto).not.toContain('cubren lo mismo')
  })

  it('con el destino leído y el origen no, tampoco se arma media cobertura', () => {
    expect(
      coberturaDeLinea(vuelo('b', 'SATENA', { origen: null, destino: 'Providencia', fecha_regreso: null })),
    ).toEqual({ estado: 'ilegible' })
  })

  it('la cobertura sale de la captura, no del nombre de la línea', () => {
    // El nombre dice la ruta entera y la captura no trae nada: sigue siendo ilegible.
    const sinIdentidad = linea('b', {
      nombre: 'SATENA SAN–PVA',
      grupo: 'vuelo',
      tarifa_pax: { casillas: { grupo_completo: lectura({}) } },
    })
    expect(coberturaDeLinea(sinIdentidad)).toEqual({ estado: 'ilegible' })
  })
})

// ── Cobertura de una línea, caso por caso ────────────────────────────────────

describe('coberturaDeLinea', () => {
  it('una línea sin grupo no aplica', () => {
    expect(coberturaDeLinea(linea('a'))).toEqual({ estado: 'no_aplica' })
  })

  it('una línea de vuelo sin captura está sin cargar, que no es lo mismo que ilegible', () => {
    expect(coberturaDeLinea(linea('a', { grupo: 'vuelo' }))).toEqual({ estado: 'sin_cargar' })
  })

  it('con regreso, la cobertura son los dos tramos', () => {
    expect(coberturaDeLinea(vuelo('a', 'AVIANCA', AVIANCA))).toEqual({
      estado: 'leida',
      tramos: [
        { desde: 'Bogotá', hasta: 'San Andrés' },
        { desde: 'San Andrés', hasta: 'Bogotá' },
      ],
    })
  })

  it('el trayecto se busca en la casilla que lo tenga, no solo en la primera', () => {
    const l = linea('a', {
      grupo: 'vuelo',
      tarifa_pax: {
        casillas: {
          grupo_completo: lectura({ origen: null, destino: null }),
          solo_adultos: lectura({ origen: 'Bogotá', destino: 'San Andrés', fecha_regreso: null }),
        },
      },
    })
    expect(coberturaDeLinea(l)).toEqual({ estado: 'leida', tramos: [{ desde: 'Bogotá', hasta: 'San Andrés' }] })
  })

  it('un jsonb roto no rompe la lectura', () => {
    expect(coberturaDeLinea(linea('a', { grupo: 'vuelo', tarifa_pax: 'no soy un objeto' }))).toEqual({
      estado: 'sin_cargar',
    })
  })
})

// ── Comparación ──────────────────────────────────────────────────────────────

describe('cómo se comparan dos coberturas', () => {
  it('tildes y mayúsculas no cuentan como diferencia', () => {
    const avisos = avisosDeCobertura([
      vuelo('a', 'AVIANCA', AVIANCA),
      vuelo('b', 'LATAM', { origen: 'BOGOTA', destino: 'san andres', fecha_regreso: '2026-11-15' }, { opcion_de: 'a', orden: 1 }),
    ])
    expect(avisos).toEqual([])
  })

  it('el ítem de ajuste no entra como opción de la ranura', () => {
    const avisos = avisosDeCobertura([
      vuelo('a', 'AVIANCA', AVIANCA),
      vuelo('ajuste', 'Ajuste', SATENA, { es_ajuste: true, orden: 9 }),
    ])
    expect(avisos).toEqual([])
  })

  it('textoDeTramo imprime el tramo tal como se leyó', () => {
    expect(textoDeTramo({ desde: 'Bogotá', hasta: 'San Andrés' })).toBe('Bogotá–San Andrés')
  })
})
