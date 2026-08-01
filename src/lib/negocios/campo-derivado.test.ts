import { describe, it, expect } from 'vitest'
import { resolverDerivado, type LockWhen } from './campo-derivado'

// El caso real que originó el mecanismo (SOENA, etapa Negociación): tres opciones de
// servicio contratado que derivan los dos campos que el motor ya lee.
const CERTIFICACION: LockWhen = {
  source_bloque_slug: 'servicio_contratado',
  field: 'servicio',
  mapping: { completo: 'true', solo_upme: 'true', solo_iva: 'false' },
}

const IVA: LockWhen = {
  source_bloque_slug: 'servicio_contratado',
  field: 'servicio',
  mapping: { completo: 'true', solo_upme: 'false', solo_iva: 'true' },
}

describe('resolverDerivado — modo mapping', () => {
  it('traduce cada respuesta de la fuente al valor del campo derivado', () => {
    expect(resolverDerivado(CERTIFICACION, 'completo').valor).toBe('true')
    expect(resolverDerivado(CERTIFICACION, 'solo_upme').valor).toBe('true')
    expect(resolverDerivado(CERTIFICACION, 'solo_iva').valor).toBe('false')

    expect(resolverDerivado(IVA, 'completo').valor).toBe('true')
    expect(resolverDerivado(IVA, 'solo_upme').valor).toBe('false')
    expect(resolverDerivado(IVA, 'solo_iva').valor).toBe('true')
  })

  it('las tres opciones válidas producen combinaciones distintas — ninguna es "ni una ni otra"', () => {
    const combinaciones = ['completo', 'solo_upme', 'solo_iva'].map(r => [
      resolverDerivado(CERTIFICACION, r).valor,
      resolverDerivado(IVA, r).valor,
    ])
    expect(new Set(combinaciones.map(c => c.join('|'))).size).toBe(3)
    // La cuarta combinación (ambos en false) es la que el formulario ya no puede producir.
    expect(combinaciones).not.toContainEqual(['false', 'false'])
  })

  it('sin respuesta de la fuente el campo queda VACÍO, nunca en false', () => {
    // Es el corazón del asunto: un `false` inventado es indistinguible de una negativa
    // deliberada, y así es como un caso se va por la rama equivocada sin que nadie lo vea.
    for (const sinRespuesta of [undefined, null, '']) {
      const r = resolverDerivado(CERTIFICACION, sinRespuesta)
      expect(r.valor).toBeUndefined()
      expect(r.valor).not.toBe('false')
    }
  })

  it('una respuesta que no está en el mapa deja el campo vacío', () => {
    expect(resolverDerivado(CERTIFICACION, 'opcion_que_alguien_agregó_después').valor).toBeUndefined()
  })

  it('el campo derivado queda bloqueado SIEMPRE, con o sin respuesta', () => {
    expect(resolverDerivado(CERTIFICACION, 'completo').bloqueado).toBe(true)
    expect(resolverDerivado(CERTIFICACION, undefined).bloqueado).toBe(true)
  })
})

describe('resolverDerivado — sin mapping, comportamiento intacto', () => {
  // La regla puntual que ya existía en producción (leasing cierra sin devolución de IVA).
  const LEASING: LockWhen = {
    source_bloque_slug: 'titularidad',
    field: 'modalidad_solicitante',
    value: 'leasing',
    force_value: false,
  }

  it('bloquea y fuerza solo cuando la fuente vale exactamente el valor declarado', () => {
    expect(resolverDerivado(LEASING, 'leasing')).toEqual({ bloqueado: true, valor: false })
    expect(resolverDerivado(LEASING, 'propia').bloqueado).toBe(false)
    expect(resolverDerivado(LEASING, undefined).bloqueado).toBe(false)
  })

  it('sin lock_when no hay derivación', () => {
    expect(resolverDerivado(undefined, 'lo_que_sea')).toEqual({ bloqueado: false, valor: undefined })
  })
})
