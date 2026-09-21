/**
 * El motivo de §3.3: opcional, elegible, y NULO cuando no se escribió.
 *
 * Lo que de verdad protege este archivo es la tercera parte. El diseño lo dice con
 * todas las letras —*«el vacío se puede ignorar, la basura hay que creérsela»*— y este
 * repo ya pagó dos veces la misma lección: un indicador que puede calcularse sobre cero
 * evidencias necesita decidir a propósito qué guarda, o «nadie contestó» acaba pesando
 * como una respuesta.
 */
import { describe, expect, it } from 'vitest'

import {
  esMotivoConocido,
  etiquetaDeMotivo,
  hayMotivo,
  MOTIVO_OTRO,
  MOTIVOS_COMBINACION,
  normalizarMotivo,
} from './motivo-combinacion'

describe('la lista de §3.3', () => {
  it('tiene las seis razones del diseño, «otro» incluido', () => {
    expect(MOTIVOS_COMBINACION).toHaveLength(6)
    expect(MOTIVOS_COMBINACION.map(m => m.codigo)).toContain(MOTIVO_OTRO)
  })

  it('no repite códigos: dos filas con el mismo código serían una categoría partida', () => {
    const codigos = MOTIVOS_COMBINACION.map(m => m.codigo)
    expect(new Set(codigos).size).toBe(codigos.length)
  })

  it('reconoce los suyos y rechaza lo demás', () => {
    expect(esMotivoConocido('horario')).toBe(true)
    expect(esMotivoConocido('lo_que_sea')).toBe(false)
    expect(esMotivoConocido('')).toBe(false)
    expect(esMotivoConocido(null)).toBe(false)
  })

  it('un código que ya no está en la lista se muestra crudo, no se pierde', () => {
    // Un registro viejo con un código retirado tiene que seguir siendo legible: es
    // exactamente el dato que §3.4 va a releer para escribir criterios.
    expect(etiquetaDeMotivo('codigo_retirado')).toBe('codigo_retirado')
    expect(etiquetaDeMotivo('horario')).toContain('horario')
  })
})

describe('sin motivo escrito, el registro guarda NULL', () => {
  it('nada contestado deja los dos campos en null', () => {
    expect(normalizarMotivo(null, null)).toEqual({ codigo: null, texto: null })
  })

  it('cadena vacía y espacios en blanco NO son una respuesta', () => {
    // Verificación 3 del encargo: «ni "no especificado" ni cadena vacía disfrazada de
    // respuesta». `''` y `null` tienen que significar lo mismo, o «nadie escribió» y
    // «alguien escribió y borró» se cuentan distinto.
    expect(normalizarMotivo('', '')).toEqual({ codigo: null, texto: null })
    expect(normalizarMotivo(null, '   ')).toEqual({ codigo: null, texto: null })
    expect(normalizarMotivo(null, '\n\t ')).toEqual({ codigo: null, texto: null })
  })

  it('`hayMotivo` distingue el vacío de una respuesta', () => {
    expect(hayMotivo(normalizarMotivo(null, null))).toBe(false)
    expect(hayMotivo(normalizarMotivo('horario', null))).toBe(true)
    expect(hayMotivo(normalizarMotivo(null, 'el cliente insistió'))).toBe(true)
  })
})

describe('lo que llega del navegador se valida', () => {
  it('un código inventado se descarta: la serie no se ensucia con categorías nuevas', () => {
    // `guardarMotivoDeTarifa` es una server action exportada, o sea un endpoint
    // alcanzable aunque el `select` solo ofrezca seis opciones.
    expect(normalizarMotivo('inventado', null).codigo).toBeNull()
  })

  it('pero el TEXTO sobrevive al código inválido', () => {
    // Lo que una persona escribió es el dato caro; el código es la etiqueta con la que
    // se agrupa. Tirar los dos por un `select` manipulado perdería lo que no se repone.
    expect(normalizarMotivo('inventado', 'el horario no le servía')).toEqual({
      codigo: null,
      texto: 'el horario no le servía',
    })
  })

  it('el texto se recorta pero no se reescribe', () => {
    expect(normalizarMotivo('cliente', '  lo pidió él  ').texto).toBe('lo pidió él')
  })

  it('«otro» SIN texto se conserva: es una respuesta, no un hueco', () => {
    // «ninguna de estas» dice algo; borrarlo dejaría el mismo registro que no haber
    // contestado, que es otra cosa y se cuenta distinto.
    expect(normalizarMotivo(MOTIVO_OTRO, '')).toEqual({ codigo: MOTIVO_OTRO, texto: null })
  })

  it('código y texto conviven: la lista corta MÁS lo que se quiera escribir', () => {
    expect(normalizarMotivo('horario', 'salía 5:20 a.m. con un infante')).toEqual({
      codigo: 'horario',
      texto: 'salía 5:20 a.m. con un infante',
    })
  })
})
