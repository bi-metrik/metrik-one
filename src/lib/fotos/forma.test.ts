/**
 * Las fotos de hotel que ya estaban en la biblioteca con forma de collage o vertical (regla de
 * fotos, 2026-10-29): no se borran, quedan marcadas y el documento no las usa.
 */
import { describe, expect, it } from 'vitest'

import type { FilaCatalogo } from './catalogo'
import { fotosParaElDocumento } from './catalogo-propuesta'
import { fotoDeLaTarjeta, vistaDeElemento } from './vista'

const fila = (id: string, extra: Partial<FilaCatalogo>): FilaCatalogo =>
  ({
    id, tipo: 'hotel', clave: 'kunuku|willemstad', nombre_clave: 'kunuku', nombre: 'Kunuku', ciudad: 'Willemstad', ref: `one://fotos-catalogo/ws/hotel/${id}.jpg`,
    origen: 'asesora', fuente_url: null, titulo_fuente: null, autor: null, licencia: null, foco_x: null, foco_y: null, proporcion: 1.5,
    revisada: true, descartadas: [], principal: false, posicion: 1, orden: null, imagen_url: null, categoria: null, ...extra,
  }) as FilaCatalogo

describe('el documento no usa los collages ni las verticales de hotel que ya estaban', () => {
  it('se saltan y las demás van por categoría: fachada → sin categoría → habitación → zonas comunes', () => {
    const filas = [
      fila('triptico', { principal: true, posicion: 1, proporcion: 2.786 }),
      fila('zonas', { posicion: 2, orden: 2, categoria: 'zonas_comunes' }),
      fila('vertical', { posicion: 3, orden: 3, proporcion: 0.669, categoria: 'fachada' }),
    ]
    expect(fotosParaElDocumento(filas, { tipo: 'hotel', clave: 'kunuku|willemstad' }).map((f) => f.id)).toEqual(['zonas'])
    const ordenadas = [
      fila('hab', { principal: true, posicion: 1, categoria: 'habitacion' }),
      fila('sin', { posicion: 2, orden: 2 }),
      fila('fachada', { posicion: 3, orden: 3, categoria: 'fachada' }),
    ]
    expect(fotosParaElDocumento(ordenadas, { tipo: 'hotel', clave: 'kunuku|willemstad' }).map((f) => f.id)).toEqual(['fachada', 'sin', 'hab'])
  })

  it('una ciudad o un tour no tienen esta regla (una panorámica de ciudad sí sirve)', () => {
    const filas = [fila('pano', { tipo: 'ciudad', clave: 'willemstad', principal: true, proporcion: 2.786, origen: 'asesora' })]
    expect(fotosParaElDocumento(filas, { tipo: 'ciudad', clave: 'willemstad' }).map((f) => f.id)).toEqual(['pano'])
  })

  it('en la biblioteca quedan marcadas («parece un collage o una foto vertical») y la tarjeta muestra la primera que sí sale', () => {
    const e = vistaDeElemento(
      { tipo: 'hotel', clave: 'kunuku|willemstad', nombre: 'Kunuku', ciudad: 'Willemstad', fotos: [fila('triptico', { principal: true, proporcion: 2.786 }), fila('hab', { posicion: 2, categoria: 'habitacion', proporcion: '1.365' as unknown as number })] },
      new Map(),
    )
    expect(e.fotos.map((f) => [f.id, f.seImprime, f.collageOVertical])).toEqual([
      ['triptico', false, true],
      ['hab', true, false],
    ])
    expect(fotoDeLaTarjeta(e).foto?.id).toBe('hab')
    const ciudad = vistaDeElemento({ tipo: 'ciudad', clave: 'willemstad', nombre: 'Willemstad', ciudad: null, fotos: [fila('pano', { tipo: 'ciudad', proporcion: 2.786 })] }, new Map())
    expect(ciudad.fotos[0]).toMatchObject({ seImprime: true, collageOVertical: false })
  })
})
