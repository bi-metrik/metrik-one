import { describe, it, expect } from 'vitest'
import {
  aplanarBloques,
  calcularNiveles,
  declaraNiveles,
  leerPedirSi,
  mensajeMinimoIncompleto,
  type CampoConNivel,
} from './niveles-solicitud'
import { camposRequeridosFaltantes } from './campo-completo'

const campo = (slug: string, extra: Partial<CampoConNivel> = {}): CampoConNivel => ({ slug, tipo: 'texto', label: slug, ...extra })

describe('leerPedirSi: el formato se valida al leer', () => {
  it('sin pedir_si no hay condición', () => {
    expect(leerPedirSi(undefined)).toEqual({ condiciones: [] })
  })

  it('acepta los cuatro casos del encargo', () => {
    for (const c of [
      { suma_de: ['ninos', 'infantes'], mayor_que: 0 },
      { field: 'numero_pasajeros', al_menos: 6 },
      { field: 'tipo_viaje', value_in: ['playa', 'crucero'] },
      { field: 'destino_tipo', value: 'internacional' },
    ]) expect(leerPedirSi(c)).toEqual({ condiciones: [c] })
  })

  it('una lista es «todas»', () => {
    const r = leerPedirSi([{ field: 'a', value: 'x' }, { field: 'b', al_menos: 1 }])
    expect('condiciones' in r && r.condiciones).toHaveLength(2)
  })

  it.each([
    ['texto suelto', 'ninos > 0'],
    ['sin comparación', { field: 'ninos' }],
    ['field y suma_de a la vez', { field: 'a', suma_de: ['b'], al_menos: 1 }],
    ['llave desconocida', { field: 'a', mayorque: 1 }],
    ['número como texto', { field: 'a', al_menos: '6' }],
    ['value sobre una suma', { suma_de: ['a'], value: '1' }],
    ['lista vacía', []],
  ])('rechaza: %s', (_nombre, raw) => {
    expect('error' in leerPedirSi(raw)).toBe(true)
  })
})

describe('calcularNiveles', () => {
  const fields: CampoConNivel[] = [
    campo('destino', { nivel: 'minimo', pregunta: '¿A dónde?' }),
    campo('ninos', { tipo: 'numero', nivel: 'minimo', default: 0 }),
    campo('edades', { nivel: 'minimo', pregunta: '¿Qué edades?', pedir_si: { suma_de: ['ninos'], mayor_que: 0 } }),
    campo('presupuesto', { nivel: 'deseable' }),
    campo('notas'),
  ]

  it('cuenta solo los campos con nivel, y pregunta en el orden de la config', () => {
    const r = calcularNiveles(fields, {})
    expect(r.minimo).toEqual({
      completos: 1, // ninos por su default 0
      total: 2,
      faltan: [{ slug: 'destino', pregunta: '¿A dónde?', label: 'destino' }],
    })
    expect(r.deseable.total).toBe(1)
    expect(r.deseable.faltan[0].pregunta).toBe('presupuesto') // sin pregunta, usa el label
    expect(r.errores).toEqual([])
  })

  it('el campo condicionado entra cuando la condición se cumple', () => {
    const r = calcularNiveles(fields, { destino: 'Madrid', ninos: 2 })
    expect(r.minimo.total).toBe(3)
    expect(r.minimo.faltan.map(f => f.slug)).toEqual(['edades'])
  })

  it('un campo oculto por showIf no cuenta', () => {
    const r = calcularNiveles([campo('x', { nivel: 'minimo', showIf: { field: 'y', equals: 'si' } })], { y: 'no' })
    expect(r.minimo.total).toBe(0)
  })

  it('usa la regla de completitud de siempre: no_cero y confirmaciones', () => {
    const r = calcularNiveles([
      campo('adultos', { tipo: 'numero', nivel: 'minimo', no_cero: true }),
      campo('ok', { tipo: 'toggle', nivel: 'minimo' }),
    ], { adultos: 0, ok: false })
    expect(r.minimo.completos).toBe(0)
  })

  it('un pedir_si mal escrito NO esconde el campo: cuenta y se reporta', () => {
    const r = calcularNiveles([campo('x', { nivel: 'minimo', pedir_si: 'ninos > 0' })], {})
    expect(r.minimo.total).toBe(1)
    expect(r.errores[0]).toMatch(/^x: pedir_si/)
  })

  it('un nivel que no existe se reporta y no suma', () => {
    const r = calcularNiveles([campo('x', { nivel: 'obligatorio' })], {})
    expect(r.minimo.total + r.deseable.total).toBe(0)
    expect(r.errores[0]).toMatch(/nivel «obligatorio»/)
  })

  it('distinto_de y value_in comparan como las condiciones de bloque (sin tildes ni mayúsculas)', () => {
    const f = [campo('x', { nivel: 'deseable', pedir_si: { field: 't', value_in: ['Crucero'] } })]
    expect(calcularNiveles(f, { t: 'crucero' }).deseable.total).toBe(1)
    const g = [campo('x', { nivel: 'deseable', pedir_si: { field: 't', distinto_de: ['otro'] } })]
    expect(calcularNiveles(g, { t: 'Otro' }).deseable.total).toBe(0)
    expect(calcularNiveles(g, { t: 'playa' }).deseable.total).toBe(1)
  })
})

// Retrocompatibilidad: una config de hoy, sin ninguna propiedad nueva.
describe('config vieja sin nivel', () => {
  const vieja: CampoConNivel[] = [
    campo('destino', { required: true }),
    campo('adultos', { tipo: 'numero', required: true, no_cero: true }),
    campo('requisitos'),
  ]

  it('no declara niveles: la pantalla no pinta barras', () => {
    expect(declaraNiveles(vieja)).toBe(false)
    const r = calcularNiveles(vieja, {})
    expect(r.minimo.total).toBe(0)
    expect(r.deseable.total).toBe(0)
  })

  it('la completitud del bloque no cambia: nivel no es required', () => {
    const conNivel = vieja.map(f => ({ ...f, nivel: 'minimo' }))
    const vals = { destino: 'Madrid' }
    expect(camposRequeridosFaltantes(conNivel, vals).map(f => f.slug))
      .toEqual(camposRequeridosFaltantes(vieja, vals).map(f => f.slug))
  })
})

describe('aplanarBloques y el mensaje del gate', () => {
  it('une campos en orden y valores por slug', () => {
    const r = aplanarBloques([
      { fields: [campo('a', { nivel: 'minimo' })], data: { a: 'x' } },
      { fields: [campo('b', { nivel: 'minimo' }), campo('a')], data: { b: '', a: 'y' } },
    ])
    expect(r.fields.map(f => f.slug)).toEqual(['a', 'b'])
    expect(r.valores).toEqual({ a: 'x', b: '' })
  })

  it('dice cuánto hay y qué falta, en forma de pregunta', () => {
    const msg = mensajeMinimoIncompleto({ completos: 5, total: 7, faltan: [
      { slug: 'f', pregunta: '¿Qué día salen?', label: 'Fecha' },
      { slug: 'e', pregunta: '¿Qué edad tiene cada niño?', label: 'Edades' },
    ] })
    expect(msg).toBe('Falta el mínimo para cotizar (5 de 7): ¿Qué día salen? · ¿Qué edad tiene cada niño?')
    expect(mensajeMinimoIncompleto({ completos: 0, total: 1, faltan: [] }, 'Texto propio')).toBe('Texto propio')
  })
})
