/**
 * Los términos de la cotización de viaje: cómo se guardan, qué se propone al abrir y cómo
 * se parten para imprimir.
 *
 * El fixture es el texto base provisional de Trappvel (`terminos-base-trappvel.md`,
 * 2026-09-23), levantado de tres cotizaciones reales: dos subtítulos, viñetas y una
 * sub-lista de cuentas. Es la forma que el PDF tiene que respetar.
 */
import { describe, expect, it } from 'vitest'

import {
  LIMITE_TERMINOS,
  estructurarTerminos,
  normalizarTerminos,
  terminosAlAbrir,
} from './terminos-cotizacion'
import { TERMINOS_BASE_TRAPPVEL } from './__fixtures__/terminos-base-trappvel'

describe('normalizarTerminos', () => {
  it('⚠️ conserva los saltos de línea y la sangría: la sub-lista de cuentas no se aplana', () => {
    const t = normalizarTerminos(TERMINOS_BASE_TRAPPVEL)!
    expect(t).toBe(TERMINOS_BASE_TRAPPVEL)
    expect(t).toContain('\n  - Banco de Bogotá, cuenta de ahorros 708030895')
  })

  it('quita espacios al final de renglón, renglones en blanco de más y los de los bordes', () => {
    expect(normalizarTerminos('\r\n\nUno.   \r\n\n\n\nDos.\t\n\n')).toBe('Uno.\n\nDos.')
  })

  it('vacío, en blanco o sin forma es null', () => {
    expect(normalizarTerminos('')).toBeNull()
    expect(normalizarTerminos('  \n \n')).toBeNull()
    expect(normalizarTerminos(null)).toBeNull()
    expect(normalizarTerminos(42)).toBeNull()
  })

  it('tiene tope', () => {
    expect(normalizarTerminos('a'.repeat(LIMITE_TERMINOS + 50))!.length).toBe(LIMITE_TERMINOS)
  })
})

describe('terminosAlAbrir', () => {
  it('con términos guardados, esos: son de ESTA cotización', () => {
    expect(terminosAlAbrir({ terminos: 'Propios.', terminosBase: TERMINOS_BASE_TRAPPVEL, editable: true }))
      .toEqual({ valor: 'Propios.', propuesto: false })
  })

  it('⚠️ un borrador sin términos propone el texto base de la línea, marcado como propuesta', () => {
    expect(terminosAlAbrir({ terminos: null, terminosBase: TERMINOS_BASE_TRAPPVEL, editable: true }))
      .toEqual({ valor: TERMINOS_BASE_TRAPPVEL, propuesto: true })
    expect(terminosAlAbrir({ terminos: '   ', terminosBase: TERMINOS_BASE_TRAPPVEL, editable: true }).propuesto).toBe(true)
  })

  it('una cotización que ya no es borrador no propone nada: no se podría guardar', () => {
    expect(terminosAlAbrir({ terminos: null, terminosBase: TERMINOS_BASE_TRAPPVEL, editable: false }))
      .toEqual({ valor: '', propuesto: false })
  })

  it('sin texto base, el cuadro queda vacío', () => {
    expect(terminosAlAbrir({ terminos: null, terminosBase: null, editable: true })).toEqual({ valor: '', propuesto: false })
  })
})

describe('estructurarTerminos', () => {
  it('⚠️⚠️ el texto base de Trappvel: dos subtítulos, sus viñetas y las cuentas en segundo nivel', () => {
    const b = estructurarTerminos(TERMINOS_BASE_TRAPPVEL)
    expect(b.filter(x => x.tipo === 'subtitulo').map(x => x.texto)).toEqual(['Condiciones generales', 'Medios de pago'])
    expect(b[0]).toEqual({ tipo: 'subtitulo', texto: 'Condiciones generales' })
    expect(b.slice(1, 6).every(x => x.tipo === 'vineta' && x.nivel === 1)).toBe(true)
    expect(b[6]).toEqual({ tipo: 'subtitulo', texto: 'Medios de pago' })
    expect(b[7]).toEqual({
      tipo: 'vineta',
      nivel: 1,
      texto: 'Consignación o transferencia a nombre de Trappvel Enterprise S.A.S., NIT 900.945.317-1:',
    })
    expect(b.slice(8, 11)).toEqual([
      { tipo: 'vineta', nivel: 2, texto: 'Banco de Bogotá, cuenta de ahorros 708030895' },
      { tipo: 'vineta', nivel: 2, texto: 'Bancolombia, cuenta de ahorros 32800003241' },
      { tipo: 'vineta', nivel: 2, texto: 'Davivienda, cuenta de ahorros 469500014383' },
    ])
    expect(b[11]).toMatchObject({ tipo: 'vineta', nivel: 1, texto: expect.stringContaining('PSE') })
    expect(b).toHaveLength(12)
    // Nada se pierde ni se inventa: ni un marcador de viñeta en el texto impreso.
    expect(b.some(x => x.texto.startsWith('-'))).toBe(false)
  })

  it('los dos puntos de un subtítulo se quitan; un renglón con punto final no es subtítulo', () => {
    expect(estructurarTerminos('Medios de pago:\n- PSE')[0]).toEqual({ tipo: 'subtitulo', texto: 'Medios de pago' })
    expect(estructurarTerminos('Las tarifas cambian.\n- PSE')[0]).toEqual({ tipo: 'parrafo', texto: 'Las tarifas cambian.' })
  })

  it('un texto sin viñetas sale en párrafos, un renglón cada uno, sin subtítulos', () => {
    expect(estructurarTerminos('Tarifas sujetas a cambio\nNo reembolsable')).toEqual([
      { tipo: 'parrafo', texto: 'Tarifas sujetas a cambio' },
      { tipo: 'parrafo', texto: 'No reembolsable' },
    ])
  })

  it('un renglón con sangría y sin marcador continúa la viñeta de arriba', () => {
    expect(estructurarTerminos('- Las cancelaciones pueden generar\n  penalidades.')).toEqual([
      { tipo: 'vineta', nivel: 1, texto: 'Las cancelaciones pueden generar penalidades.' },
    ])
  })

  it('acepta los marcadores que la gente pega (•, *, ·) y deja los números como están', () => {
    expect(estructurarTerminos('• Uno\n* Dos\n· Tres').map(x => x.tipo)).toEqual(['vineta', 'vineta', 'vineta'])
    expect(estructurarTerminos('1. Primera condición')).toEqual([{ tipo: 'parrafo', texto: '1. Primera condición' }])
  })

  it('sin términos no hay bloques', () => {
    expect(estructurarTerminos(null)).toEqual([])
    expect(estructurarTerminos('  \n ')).toEqual([])
  })
})
