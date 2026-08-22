import { describe, it, expect } from 'vitest'
import {
  decidirSegmento,
  extraerEtiqueta,
  normalizarEtiqueta,
  SEGMENTOS_DESTINO,
  SEGMENTOS_VIVOS,
  ETIQUETAS_CONOCIDAS,
} from './segmento'

describe('el mapa no se separa del catalogo', () => {
  // La regresion que este test cubre YA paso: el primer barrido mando 16 contactos
  // a `contactado` y `convertido`, que pasan el CHECK de la tabla pero el catalogo
  // esta retirando. En pantalla quedaron como chips grises "desconocido" sin que
  // nada fallara.
  it('todo destino es un valor vivo del catalogo', () => {
    for (const destino of SEGMENTOS_DESTINO) {
      expect(SEGMENTOS_VIVOS).toContain(destino)
    }
  })

  it('cubre las nueve etiquetas que hoy existen en FunnelChat', () => {
    for (const tag of [
      'lead', 'no contesta', 'seguimiento', 'propuesta', 'cerrado',
      'conectado', 'calificado', 'no calificado', 'pendiente bizagi',
    ]) {
      expect(ETIQUETAS_CONOCIDAS).toContain(tag)
    }
  })
})

describe('normalizarEtiqueta', () => {
  it('lo escribe quien administra FunnelChat, no nosotros', () => {
    expect(normalizarEtiqueta('Pendiente BIZAGI')).toBe('pendiente bizagi')
    expect(normalizarEtiqueta('  No   Contesta ')).toBe('no contesta')
    expect(normalizarEtiqueta('Calificádo')).toBe('calificado')
  })
})

describe('extraerEtiqueta', () => {
  it('acepta el nombre de campo que se haya usado en el flujo', () => {
    for (const clave of ['etiqueta', 'tag', 'label']) {
      expect(extraerEtiqueta({ [clave]: 'Seguimiento' })).toBe('Seguimiento')
    }
  })

  it('un cuerpo sin etiqueta no inventa una', () => {
    expect(extraerEtiqueta({ telefono: '3127226316' })).toBeNull()
    expect(extraerEtiqueta({ etiqueta: '   ' })).toBeNull()
  })
})

describe('decidirSegmento', () => {
  it('avanza cuando la etiqueta esta mas adelante', () => {
    const d = decidirSegmento('Seguimiento', 'sin_contactar')
    expect(d).toEqual({
      estado: 'aplica', etiqueta: 'Seguimiento', anterior: 'sin_contactar', nuevo: 'primer_contacto',
    })
  })

  it('nunca retrocede: un evento tardio no tumba lo que ya se decidio', () => {
    const d = decidirSegmento('No contesta', 'descartado')
    expect(d.estado).toBe('no_retrocede')
  })

  it('el contacto sin segmento arranca desde abajo', () => {
    expect(decidirSegmento('No contesta', null).estado).toBe('aplica')
  })

  it('un segmento legacy no deja el contacto clavado', () => {
    // `contactado` no esta en RANGO. Se trata como el principio de la escala para
    // que la sincronizacion pueda sacarlo de ahi.
    expect(decidirSegmento('No contesta', 'contactado').estado).toBe('aplica')
  })

  it('la misma etiqueta dos veces no escribe dos veces', () => {
    expect(decidirSegmento('No contesta', 'no_contesto').estado).toBe('sin_cambio')
  })

  it('una etiqueta nueva se reporta, no se ignora', () => {
    const d = decidirSegmento('Garantia extendida', 'sin_contactar')
    expect(d).toEqual({ estado: 'etiqueta_desconocida', etiqueta: 'Garantia extendida' })
  })

  it('sin etiqueta el veredicto lo dice', () => {
    expect(decidirSegmento(null, 'sin_contactar').estado).toBe('sin_etiqueta')
  })

  it('Cerrado no escribe un valor de venta en un campo de contacto', () => {
    const d = decidirSegmento('Cerrado', 'sin_contactar')
    expect(d.estado === 'aplica' && d.nuevo).toBe('conectado')
  })
})
