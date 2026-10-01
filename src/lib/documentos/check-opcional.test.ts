import { describe, expect, it } from 'vitest'
import { checkSeSalta, sociedadAcompananteSeSalta } from './check-opcional'
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

// Datos inventados con la forma de V0321/V0323/V0537 (certificados de 2024 a nombre de la
// persona Y de la sociedad del proyecto).
describe('sociedadAcompananteSeSalta — la sociedad en el lugar del 2º solicitante', () => {
  it('un solo titular, sin nada contra qué compararla: se salta (por nombre o por NIT)', () => {
    expect(sociedadAcompananteSeSalta(SEGUNDO_SOLICITANTE, 'PROYECTOS SOLARES DEL VALLE SAS', '', fuentes('unico'))).toBe(true)
    expect(sociedadAcompananteSeSalta(SEGUNDO_SOLICITANTE, '900987654', '', fuentes('unico'))).toBe(true)
  })

  it('copropiedad: el lugar es obligatorio, no se salta', () => {
    expect(sociedadAcompananteSeSalta(SEGUNDO_SOLICITANTE, 'PROYECTOS SOLARES DEL VALLE SAS', '', fuentes('copropiedad'))).toBe(false)
  })

  it('sin la titularidad no se sabe si es obligatorio: no se salta', () => {
    expect(sociedadAcompananteSeSalta(SEGUNDO_SOLICITANTE, 'PROYECTOS SOLARES DEL VALLE SAS', '', fuentes(undefined))).toBe(false)
  })

  it('una persona natural, o una sociedad con contra qué compararla, no se salta', () => {
    expect(sociedadAcompananteSeSalta(SEGUNDO_SOLICITANTE, 'LOPEZ ROJAS ANA', '', fuentes('unico'))).toBe(false)
    expect(sociedadAcompananteSeSalta(SEGUNDO_SOLICITANTE, '52123456', '', fuentes('unico'))).toBe(false)
    expect(sociedadAcompananteSeSalta(SEGUNDO_SOLICITANTE, 'BANCO DEL EJEMPLO SA', 'BANCO DEL EJEMPLO S.A.', fuentes('unico'))).toBe(false)
  })

  it('un check que no es opcional nunca se salta', () => {
    expect(sociedadAcompananteSeSalta({}, 'PROYECTOS SOLARES DEL VALLE SAS', '', fuentes('unico'))).toBe(false)
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
