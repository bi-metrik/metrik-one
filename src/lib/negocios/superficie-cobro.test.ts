import { describe, it, expect } from 'vitest'
import { BANDERAS_CAPTURA_COBRO, esSuperficieDeCapturaDeCobro } from './superficie-cobro'

describe('esSuperficieDeCapturaDeCobro', () => {
  it('reconoce las cuatro superficies que hoy capturan dinero', () => {
    for (const bandera of BANDERAS_CAPTURA_COBRO) {
      expect(esSuperficieDeCapturaDeCobro({ [bandera]: true }), bandera).toBe(true)
    }
  })

  it('un bloque de datos corriente NO es superficie de captura', () => {
    expect(esSuperficieDeCapturaDeCobro({ label: 'Titularidad', require_confirm: true })).toBe(false)
  })

  it('la bandera declarada en false no cuenta', () => {
    // Config que dejó de ser de pago: apagar la bandera tiene que apagar el aviso,
    // no dejarlo prendido por la sola presencia de la clave.
    expect(esSuperficieDeCapturaDeCobro({ es_pago_externo: false })).toBe(false)
  })

  it('sin config no revienta ni inventa una superficie', () => {
    expect(esSuperficieDeCapturaDeCobro(null)).toBe(false)
    expect(esSuperficieDeCapturaDeCobro(undefined)).toBe(false)
    expect(esSuperficieDeCapturaDeCobro({})).toBe(false)
  })

  it('un valor truthy que no es true tampoco cuenta', () => {
    // La config viaja como jsonb desde la base: un `"true"` de texto o un 1 son
    // datos mal escritos, no una declaración. Prender el aviso ahí escondería el
    // error de configuración detrás de un comportamiento que parece correcto.
    expect(esSuperficieDeCapturaDeCobro({ es_multi_pago: 'true' })).toBe(false)
    expect(esSuperficieDeCapturaDeCobro({ es_multi_pago: 1 })).toBe(false)
  })
})
