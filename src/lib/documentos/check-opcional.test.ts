import { describe, expect, it } from 'vitest'
import { checkSeSalta } from './check-opcional'
import { bloqueOcultoEnHistorial } from '@/lib/negocios/bloque-oculto-historial'

// El `required_when` real de SOENA sobre el 2º solicitante del certificado UPME.
const SEGUNDO_SOLICITANTE = {
  optional: true,
  required_when: { field: 'modalidad_solicitante', value: 'copropiedad', source_bloque_slug: 'titularidad', source_etapa_orden: 4 },
}
const fuentes = (modalidad: string | undefined) => ({
  porSlug: { titularidad: modalidad ? { modalidad_solicitante: modalidad } : {} },
  porEtapaOrden: {},
})

describe('checkSeSalta — el 2º solicitante del certificado UPME', () => {
  it('copropiedad y certificado con una sola persona: NO se salta (se compara y falla)', () => {
    expect(checkSeSalta(SEGUNDO_SOLICITANTE, '', fuentes('copropiedad'))).toBe(false)
  })

  it('único y certificado con una sola persona: se salta, como antes', () => {
    expect(checkSeSalta(SEGUNDO_SOLICITANTE, '', fuentes('unico'))).toBe(true)
  })

  it('sin titularidad respondida: sigue siendo opcional', () => {
    expect(checkSeSalta(SEGUNDO_SOLICITANTE, '', fuentes(undefined))).toBe(true)
  })

  it('con valor extraído nunca se salta: se compara siempre', () => {
    expect(checkSeSalta(SEGUNDO_SOLICITANTE, 'LOPEZ VELEZ', fuentes('unico'))).toBe(false)
  })

  it('un check sin `optional` nunca se salta, y uno sin `required_when` se comporta como antes', () => {
    expect(checkSeSalta({}, '', fuentes('copropiedad'))).toBe(false)
    expect(checkSeSalta({ optional: true }, '', fuentes('copropiedad'))).toBe(true)
  })
})

describe('bloqueOcultoEnHistorial', () => {
  it('solo con el flag explícito; `visible: false` y `desactivado` no cuentan', () => {
    expect(bloqueOcultoEnHistorial({ oculto_en_historial: true })).toBe(true)
    expect(bloqueOcultoEnHistorial({ visible: false })).toBe(false)
    expect(bloqueOcultoEnHistorial({ desactivado: true })).toBe(false)
    expect(bloqueOcultoEnHistorial(null)).toBe(false)
  })
})
