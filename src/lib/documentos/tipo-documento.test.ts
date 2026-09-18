/**
 * El catálogo de documentos y la regla del veredicto.
 *
 * Lo que esto fija, además de los casos obvios:
 *  · **Un valor fuera del catálogo apaga el control, no lo invierte.** Un `documento_esperado`
 *    mal escrito («camara_de_comercio») no puede coincidir nunca con lo que el lector
 *    devuelve, así que un control ingenuo rechazaría TODO lo que entre a ese bloque. Se
 *    prefiere el control apagado: un error de configuración no puede frenar la operación.
 *  · **El contrato entre el catálogo y el `enum` del esquema.** El lector le pasa a Gemini
 *    `VALORES_RECONOCIBLES` como lista cerrada; si alguien agrega un tipo al catálogo y esa
 *    lista no lo incluye, el modelo nunca lo puede decir y el bloque que lo espere rechazará
 *    todo. Es la misma familia del CHECK de `activity_log` que admitía siete valores mientras
 *    el código insertaba quince.
 */

import { describe, it, expect } from 'vitest'
import {
  CONFIANZA_MINIMA_DEFAULT,
  TIPOS_DOCUMENTO,
  TIPO_ILEGIBLE,
  TIPO_OTRO,
  VALORES_RECONOCIBLES,
  etiquetaEsperado,
  etiquetaTipo,
  expectativaDeDocumento,
  mensajeDocumentoRechazado,
  veredictoDocumento,
  type Reconocimiento,
} from './tipo-documento'

const seguro = (tipo: string): Reconocimiento => ({ tipo: tipo as Reconocimiento['tipo'], confianza: 0.98, evidencia: '' })

describe('el catálogo y el esquema que ve el modelo no se pueden separar', () => {
  it('todo tipo del catálogo es un valor que el lector puede devolver', () => {
    for (const slug of Object.keys(TIPOS_DOCUMENTO)) {
      expect(VALORES_RECONOCIBLES).toContain(slug)
    }
    expect(VALORES_RECONOCIBLES).toContain(TIPO_OTRO)
    expect(VALORES_RECONOCIBLES).toContain(TIPO_ILEGIBLE)
    expect(VALORES_RECONOCIBLES).toHaveLength(Object.keys(TIPOS_DOCUMENTO).length + 2)
  })

  it('cada tipo trae label y una descripción con la que distinguirlo', () => {
    for (const [slug, d] of Object.entries(TIPOS_DOCUMENTO)) {
      expect(d.label.length, slug).toBeGreaterThan(3)
      expect(d.descripcion.length, slug).toBeGreaterThan(40)
    }
  })
})

describe('expectativaDeDocumento', () => {
  it('sin la llave, no hay expectativa (los 37 bloques de hoy)', () => {
    expect(expectativaDeDocumento({})).toBeNull()
    expect(expectativaDeDocumento(null)).toBeNull()
    expect(expectativaDeDocumento({ documento_esperado: null })).toBeNull()
  })

  it('acepta un solo tipo o una lista, y no repite', () => {
    expect(expectativaDeDocumento({ documento_esperado: 'rut' })?.tipos).toEqual(['rut'])
    expect(expectativaDeDocumento({ documento_esperado: ['rut', 'camara_comercio', 'rut'] })?.tipos)
      .toEqual(['rut', 'camara_comercio'])
  })

  it('un tipo que no existe se descarta, y si no queda ninguno el control queda apagado', () => {
    expect(expectativaDeDocumento({ documento_esperado: 'camara_de_comercio' })).toBeNull()
    expect(expectativaDeDocumento({ documento_esperado: ['rut', 'inventado'] })?.tipos).toEqual(['rut'])
  })

  it('el umbral es el 0.70 de la extracción salvo que el bloque declare otro', () => {
    expect(expectativaDeDocumento({ documento_esperado: 'rut' })?.confianzaMinima)
      .toBe(CONFIANZA_MINIMA_DEFAULT)
    expect(expectativaDeDocumento({ documento_esperado: 'rut', documento_esperado_confianza_min: 0.95 })?.confianzaMinima)
      .toBe(0.95)
    // Fuera de rango o con otro tipo, se ignora: no se deja un umbral que no signifique nada.
    expect(expectativaDeDocumento({ documento_esperado: 'rut', documento_esperado_confianza_min: 7 })?.confianzaMinima)
      .toBe(CONFIANZA_MINIMA_DEFAULT)
    expect(expectativaDeDocumento({ documento_esperado: 'rut', documento_esperado_confianza_min: 'alto' })?.confianzaMinima)
      .toBe(CONFIANZA_MINIMA_DEFAULT)
  })
})

describe('veredictoDocumento', () => {
  const rut = expectativaDeDocumento({ documento_esperado: 'rut' })!

  it('sin expectativa o sin lectura, nadie juzga nada', () => {
    expect(veredictoDocumento(null, seguro('camara_comercio'))).toEqual({ acepta: true, motivo: 'sin_comprobar' })
    expect(veredictoDocumento(rut, null)).toEqual({ acepta: true, motivo: 'sin_comprobar' })
  })

  it('coincide cuando es uno de los tipos declarados', () => {
    const dos = expectativaDeDocumento({ documento_esperado: ['rut', 'camara_comercio'] })!
    expect(veredictoDocumento(dos, seguro('camara_comercio'))).toEqual({ acepta: true, motivo: 'coincide' })
  })

  it('rechaza SOLO con otro tipo conocido y confianza suficiente', () => {
    expect(veredictoDocumento(rut, seguro('camara_comercio')))
      .toEqual({ acepta: false, motivo: 'documento_distinto' })
    expect(veredictoDocumento(rut, { tipo: 'camara_comercio', confianza: 0.69, evidencia: '' }))
      .toEqual({ acepta: true, motivo: 'no_concluyente' })
    expect(veredictoDocumento(rut, seguro(TIPO_OTRO))).toEqual({ acepta: true, motivo: 'no_concluyente' })
    expect(veredictoDocumento(rut, seguro(TIPO_ILEGIBLE))).toEqual({ acepta: true, motivo: 'no_concluyente' })
  })

  it('el umbral es el borde exacto: 0.70 con default rechaza', () => {
    expect(veredictoDocumento(rut, { tipo: 'camara_comercio', confianza: 0.7, evidencia: '' }).acepta).toBe(false)
  })
})

describe('lo que el operador lee', () => {
  it('nombra los dos documentos y dice que no se guardó nada', () => {
    const rut = expectativaDeDocumento({ documento_esperado: 'rut' })!
    const msg = mensajeDocumentoRechazado(rut, seguro('camara_comercio'))
    expect(msg).toContain('RUT de la DIAN')
    expect(msg).toContain('Certificado de Cámara de Comercio')
    expect(msg).toContain('No se guardó')
  })

  it('con varios tipos aceptables los enumera', () => {
    const dos = expectativaDeDocumento({ documento_esperado: ['rut', 'camara_comercio'] })!
    expect(etiquetaEsperado(dos)).toBe('RUT de la DIAN o Certificado de Cámara de Comercio')
  })

  it('`otro` e `ilegible` se dicen en palabras, no con su slug', () => {
    expect(etiquetaTipo(TIPO_ILEGIBLE)).toBe('un archivo que no se pudo leer')
    expect(etiquetaTipo(TIPO_OTRO)).toBe('otro documento')
    expect(etiquetaTipo('rut')).toBe('RUT de la DIAN')
  })
})
