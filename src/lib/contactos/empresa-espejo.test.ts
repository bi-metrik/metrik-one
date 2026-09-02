import { describe, it, expect } from 'vitest'
import { esEmpresaEspejo } from './empresa-espejo'

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
