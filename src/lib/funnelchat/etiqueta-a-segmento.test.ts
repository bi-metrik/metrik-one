import { describe, it, expect } from 'vitest'
import { normalizarEtiqueta, telefonoMovilCo, resolverSegmento } from './etiqueta-a-segmento'

const MAPA = {
  Lead: 'sin_contactar',
  Seguimiento: 'primer_contacto',
  'No contesta': 'no_contesto',
  Conectado: 'conectado',
  'No calificado': 'descartado',
}

describe('telefonoMovilCo', () => {
  // El caso que decide si la integracion sirve: FunnelChat manda con indicativo y
  // ONE guarda sin el. Si esto se rompe, el webhook responde 200 y no pasa nada.
  it('quita el indicativo con el que llega de FunnelChat', () => {
    expect(telefonoMovilCo('573155542420')).toBe('3155542420')
    expect(telefonoMovilCo('+573155542420')).toBe('3155542420')
  })

  it('tolera como estan guardados los telefonos en el directorio', () => {
    expect(telefonoMovilCo('3155542420')).toBe('3155542420')
    expect(telefonoMovilCo('+57(322)604-3955')).toBe('3226043955')
  })

  it('rechaza lo que no es un movil colombiano en vez de buscarlo por sufijo', () => {
    expect(telefonoMovilCo('6014567890')).toBeNull()   // fijo de Bogota
    expect(telefonoMovilCo('12125551234')).toBeNull()  // numero de EE.UU.
    expect(telefonoMovilCo('315950')).toBeNull()
    expect(telefonoMovilCo('')).toBeNull()
    expect(telefonoMovilCo(null)).toBeNull()
  })
})

describe('normalizarEtiqueta', () => {
  it('iguala las variantes que escribe una persona', () => {
    expect(normalizarEtiqueta('No Contestá ')).toBe(normalizarEtiqueta('no contesta'))
    expect(normalizarEtiqueta('  Seguimiento')).toBe('seguimiento')
  })
})

describe('resolverSegmento', () => {
  it('traduce las etiquetas del mapa', () => {
    expect(resolverSegmento('Seguimiento', MAPA)).toEqual({ ok: true, segmento: 'primer_contacto' })
    expect(resolverSegmento('no contesta', MAPA)).toEqual({ ok: true, segmento: 'no_contesto' })
  })

  // Un mapa parcial es el estado normal: "Pendiente Bizagi" describe el caso, no la
  // gestion del contacto. No se le inventa un status.
  it('no traduce lo que no esta en el mapa', () => {
    const r = resolverSegmento('Pendiente Bizagi', MAPA)
    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ motivo: 'etiqueta_sin_mapa' })
  })

  it('avisa cuando falta configurar el mapa en vez de callarse', () => {
    expect(resolverSegmento('Seguimiento', undefined)).toMatchObject({ motivo: 'sin_mapa_configurado' })
    expect(resolverSegmento('Seguimiento', {})).toMatchObject({ motivo: 'sin_mapa_configurado' })
  })

  // El mapa se edita a mano en config_extra: un dedazo escribiria en la columna un
  // status que el catalogo no reconoce y el chip saldria en gris sin explicacion.
  it('rechaza un destino que no esta en el catalogo de status', () => {
    expect(resolverSegmento('Seguimiento', { Seguimiento: 'primer_contcto' })).toMatchObject({
      motivo: 'segmento_invalido',
    })
  })
})
