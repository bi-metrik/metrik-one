import { describe, it, expect } from 'vitest'

import { remapearOpcionDe, itinerariosParaLaCopia } from './duplicar-opciones'

describe('remapearOpcionDe', () => {
  const mapa = new Map([
    ['avianca', 'copia-avianca'],
    ['wingo', 'copia-wingo'],
    ['hotel', 'copia-hotel'],
  ])

  it('traduce el vínculo al mundo de la copia', () => {
    const patches = remapearOpcionDe(
      [
        { id: 'avianca', opcion_de: null },
        { id: 'wingo', opcion_de: 'avianca' },
      ],
      mapa,
    )
    expect(patches).toEqual([{ nuevoId: 'copia-wingo', opcionDe: 'copia-avianca' }])
  })

  it('NO deja el id del original: sería la copia colgando de la cotización vieja', () => {
    // Este es el defecto que la función existe para evitar. Si el titular no se
    // copió, el vínculo se pierde a propósito y la opción queda como titular suelto
    // —visible— en vez de apuntar a otro documento —invisible—.
    const patches = remapearOpcionDe([{ id: 'wingo', opcion_de: 'titular-que-no-se-copio' }], mapa)
    expect(patches).toEqual([{ nuevoId: 'copia-wingo', opcionDe: null }])
    expect(JSON.stringify(patches)).not.toContain('titular-que-no-se-copio')
  })

  it('un titular no genera UPDATE: no apunta a nadie', () => {
    expect(remapearOpcionDe([{ id: 'avianca', opcion_de: null }], mapa)).toEqual([])
    expect(remapearOpcionDe([{ id: 'avianca' }], mapa)).toEqual([])
  })

  it('un ítem que no se copió no genera UPDATE', () => {
    expect(remapearOpcionDe([{ id: 'fantasma', opcion_de: 'avianca' }], mapa)).toEqual([])
  })
})

describe('itinerariosParaLaCopia', () => {
  const mapa = new Map([
    ['avianca', 'c-avianca'],
    ['wingo', 'c-wingo'],
    ['hotel-a', 'c-hotel-a'],
  ])

  it('traduce la selección entera y conserva el nombre y el orden', () => {
    const copias = itinerariosParaLaCopia(
      [
        {
          id: 'it-1',
          nombre: 'Recomendada',
          orden: 2,
          va_en_propuesta: true,
          es_principal: true,
          seleccion: ['avianca', 'hotel-a'],
        },
      ],
      mapa,
      'cot-nueva',
      'ws-1',
    )
    expect(copias).toHaveLength(1)
    expect(copias[0].seleccion).toEqual(['c-avianca', 'c-hotel-a'])
    expect(copias[0].cabecera).toMatchObject({
      cotizacion_id: 'cot-nueva',
      workspace_id: 'ws-1',
      nombre: 'Recomendada',
      orden: 2,
      va_en_propuesta: true,
      es_principal: true,
    })
  })

  it('la selección NO conserva un solo id del original', () => {
    const copias = itinerariosParaLaCopia(
      [{ id: 'it-1', nombre: null, orden: 1, va_en_propuesta: false, es_principal: false, seleccion: ['avianca', 'wingo'] }],
      mapa,
      'cot-nueva',
      'ws-1',
    )
    for (const id of copias[0].seleccion) expect(mapa.has(id)).toBe(false)
    expect(copias[0].seleccion).not.toContain('avianca')
  })

  it('un itinerario con un ítem sin copiar se conserva INCOMPLETO, no se borra', () => {
    // R2 lo marcará incompleto y nadie podrá mandarlo al cliente. Borrarlo en
    // silencio le quitaría a alguien una combinación que armó.
    const copias = itinerariosParaLaCopia(
      [{ id: 'it-1', nombre: 'Económica', orden: 1, va_en_propuesta: false, es_principal: false, seleccion: ['avianca', 'borrado'] }],
      mapa,
      'cot-nueva',
      'ws-1',
    )
    expect(copias).toHaveLength(1)
    expect(copias[0].seleccion).toEqual(['c-avianca'])
  })

  it('conserva el vínculo con el original para poder encadenar la selección', () => {
    const copias = itinerariosParaLaCopia(
      [{ id: 'it-7', nombre: null, orden: 1, va_en_propuesta: false, es_principal: false, seleccion: [] }],
      mapa,
      'cot-nueva',
      'ws-1',
    )
    expect(copias[0].origenId).toBe('it-7')
  })
})
