import { describe, it, expect } from 'vitest'
import { esEmpresaEspejo, esEspejoDeContacto } from './empresa-espejo'

/**
 * El criterio son DOS condiciones, no una. Estas pruebas fijan los casos que
 * existen hoy en producción (SOENA, 2026-09-02) y los que romperían la regla si
 * alguien la relajara a "tipo_persona = natural" o a coincidencia de nombres.
 */

const CONTACTO = '3cbec75d-ae55-4890-a173-2d1d051c4549'

describe('esEmpresaEspejo', () => {
  it('natural con el contacto_id del negocio: es la persona, no una empresa', () => {
    expect(esEmpresaEspejo({ tipo_persona: 'natural', contacto_id: CONTACTO }, CONTACTO)).toBe(true)
  })

  it('jurídica se pinta como empresa aunque apunte al MISMO contacto', () => {
    // Caso real V0276 (CAROL CARRILLO): juridica con contacto_id = el del
    // negocio. Es uno de los 6 negocios del workspace que NO son espejo.
    expect(esEmpresaEspejo({ tipo_persona: 'juridica', contacto_id: CONTACTO }, CONTACTO)).toBe(false)
  })

  it('natural SIN contacto_id cae al bloque de empresa', () => {
    // Se ve duplicado, y es mejor que esconder una empresa que sí era otra cosa.
    expect(esEmpresaEspejo({ tipo_persona: 'natural', contacto_id: null }, CONTACTO)).toBe(false)
  })

  it('natural apuntando a OTRO contacto no es espejo de este negocio', () => {
    expect(esEmpresaEspejo({ tipo_persona: 'natural', contacto_id: 'otro-id' }, CONTACTO)).toBe(false)
  })

  it('sin empresa o sin contacto no hay espejo', () => {
    expect(esEmpresaEspejo(null, CONTACTO)).toBe(false)
    expect(esEmpresaEspejo({ tipo_persona: 'natural', contacto_id: CONTACTO }, null)).toBe(false)
  })
})

/**
 * El predicado del DIRECTORIO. No hay negocio ni contacto de referencia contra
 * el cual comparar: la pregunta es si la empresa tiene dueño humano declarado.
 * Sigue necesitando las dos condiciones — relajarlo a `tipo_persona = natural`
 * escondería una empresa real y a `contacto_id != null` escondería el caso
 * V0276.
 */
describe('esEspejoDeContacto', () => {
  it('natural con contacto_id: es una persona, el directorio la esconde', () => {
    expect(esEspejoDeContacto({ tipo_persona: 'natural', contacto_id: CONTACTO })).toBe(true)
  })

  it('jurídica CON contacto_id sigue visible: es una empresa de verdad', () => {
    // Caso real C9 / negocio V0276 (CAROL CARRILLO). Es la única `juridica` con
    // `contacto_id` del workspace y esconderla sería perder una de las 6.
    expect(esEspejoDeContacto({ tipo_persona: 'juridica', contacto_id: CONTACTO })).toBe(false)
  })

  it('natural SIN contacto_id sigue visible: no hay dueño humano declarado', () => {
    // Hoy no existe ninguna en SOENA, pero la que aparezca no se puede esconder:
    // sin `contacto_id` no hay ficha de contacto a la cual mandar a quien entre.
    expect(esEspejoDeContacto({ tipo_persona: 'natural', contacto_id: null })).toBe(false)
  })

  it('jurídica sin contacto_id es el caso normal de empresa', () => {
    expect(esEspejoDeContacto({ tipo_persona: 'juridica', contacto_id: null })).toBe(false)
  })

  it('sin tipo_persona no se esconde nada', () => {
    expect(esEspejoDeContacto({ tipo_persona: null, contacto_id: CONTACTO })).toBe(false)
  })

  it('reparte las 180 empresas de SOENA en 174 escondidas y 6 visibles', () => {
    // Réplica del censo de producción del 2026-09-02: 174 `natural` con
    // contacto, 5 `juridica` sueltas y la `juridica` con contacto (V0276).
    const empresas = [
      ...Array.from({ length: 174 }, (_, i) => ({
        tipo_persona: 'natural',
        contacto_id: `contacto-${i}`,
      })),
      ...Array.from({ length: 5 }, () => ({ tipo_persona: 'juridica', contacto_id: null })),
      { tipo_persona: 'juridica', contacto_id: CONTACTO },
    ]

    expect(empresas.filter(esEspejoDeContacto)).toHaveLength(174)
    expect(empresas.filter(e => !esEspejoDeContacto(e))).toHaveLength(6)
  })
})
