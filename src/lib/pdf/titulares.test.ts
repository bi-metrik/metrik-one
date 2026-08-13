import { describe, it, expect } from 'vitest'
import { titularesDeDatos, nitConDv, concordancia } from './titulares'

describe('titularesDeDatos', () => {
  it('sin segundo titular devuelve uno solo', () => {
    const t = titularesDeDatos({ nombre_solicitante: 'ANA GOMEZ', numero_identificacion: '79123456' })
    expect(t).toHaveLength(1)
    expect(t[0].nombre).toBe('ANA GOMEZ')
  })

  it('con segundo titular devuelve los dos, en orden', () => {
    const t = titularesDeDatos({
      nombre_solicitante: 'ANA GOMEZ', numero_identificacion: '79123456',
      nombre_solicitante_2: 'LUIS PEREZ', numero_identificacion_2: '52987654',
    })
    expect(t.map(x => x.nombre)).toEqual(['ANA GOMEZ', 'LUIS PEREZ'])
    expect(t[1].identificacion).toBe('52987654')
  })

  /**
   * El caso que decide el diseño: un RUT del solicitante 2 cargado a medias. Sin
   * nombre no se puede firmar, y una línea de firma en blanco en un documento que
   * va a la DIAN es peor que no incluirla.
   */
  it('identificación del segundo SIN nombre no crea un firmante', () => {
    const t = titularesDeDatos({
      nombre_solicitante: 'ANA GOMEZ', numero_identificacion: '79123456',
      numero_identificacion_2: '52987654',
    })
    expect(t).toHaveLength(1)
  })

  it('un nombre en blanco o con espacios tampoco crea firmante', () => {
    expect(titularesDeDatos({ nombre_solicitante: 'ANA', nombre_solicitante_2: '' })).toHaveLength(1)
    expect(titularesDeDatos({ nombre_solicitante: 'ANA', nombre_solicitante_2: '   ' })).toHaveLength(1)
  })

  it('el primer titular se devuelve siempre, con marcador si falta', () => {
    const t = titularesDeDatos({})
    expect(t).toHaveLength(1)
    expect(t[0].nombre).toBe('[NOMBRE SOLICITANTE]')
    expect(t[0].identificacion).toBeNull()
  })
})

describe('nitConDv', () => {
  it('calcula el dígito de verificación sobre la base limpia', () => {
    // 860019063-8 es el ejemplo que ya usa el helper de NIT del repo.
    expect(nitConDv('860019063')).toBe('860019063-8')
  })

  it('sin identificación devuelve el marcador, no un guion suelto', () => {
    expect(nitConDv(null)).toBe('[NIT]')
    expect(nitConDv('  ')).toBe('[NIT]')
  })
})

describe('concordancia', () => {
  it('un titular conjuga en singular', () => {
    const c = concordancia(1)
    expect(c.yo).toBe('Yo')
    expect(c.manifiesto).toBe('manifiesto')
    expect(c.declaro).toBe('Declaro')
    expect(c.plural).toBe(false)
  })

  it('dos titulares conjugan el cuerpo en plural', () => {
    const c = concordancia(2)
    expect(c.yo).toBe('Nosotros')
    expect(c.manifiesto).toBe('manifestamos')
    expect(c.declaro).toBe('Declaramos')
    expect(c.solicitante).toBe('solicitantes')
    expect(c.presento).toBe('presentamos')
  })

  /**
   * `identificado` es la excepción a propósito: acompaña a CADA persona, no al
   * conjunto ("ANA, identificada con NIT X, y LUIS, identificado con NIT Y").
   */
  it('la identificación se mantiene por persona, en singular', () => {
    expect(concordancia(2).identificado).toBe('identificado(a)')
    expect(concordancia(1).identificado).toBe('identificado(a)')
  })

  /**
   * Las formas del cuerpo viven juntas para que un documento no conjugue la mitad
   * de sus frases en singular y la otra en plural: si mañana se agrega una, entra
   * aquí y esta prueba la obliga a declararse.
   */
  it('ninguna forma del cuerpo se queda en singular cuando son dos', () => {
    const c = concordancia(2)
    const singulares = ['Yo', 'manifiesto', 'Declaro', 'solicitante', 'presento']
    for (const [clave, valor] of Object.entries(c)) {
      if (typeof valor === 'string' && clave !== 'identificado') {
        expect(singulares, `"${clave}" quedó en singular`).not.toContain(valor)
      }
    }
  })
})
