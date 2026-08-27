import { describe, it, expect } from 'vitest'
import {
  indexarValoresDeBloques,
  leerCampo,
  paresDeCampos,
} from './campos-de-bloques'

describe('paresDeCampos', () => {
  it('arma un par por cada campo del bloque', () => {
    expect(paresDeCampos([{ bloque: 'Factura', campos: ['marca', 'linea'] }])).toEqual([
      { bloque: 'Factura', campo: 'marca' },
      { bloque: 'Factura', campo: 'linea' },
    ])
  })

  it('descarta bloques y campos sin configurar', () => {
    expect(paresDeCampos([
      { bloque: undefined, campos: ['marca'] },
      { bloque: 'RUT', campos: [undefined] },
    ])).toEqual([])
  })

  it('no repite el mismo par', () => {
    expect(paresDeCampos([
      { bloque: 'RUT', campos: ['cedula', 'cedula'] },
      { bloque: 'RUT', campos: ['cedula'] },
    ])).toEqual([{ bloque: 'RUT', campo: 'cedula' }])
  })

  it('el mismo campo en dos bloques son dos pares distintos', () => {
    expect(paresDeCampos([
      { bloque: 'RUT', campos: ['numero'] },
      { bloque: 'Factura', campos: ['numero'] },
    ])).toHaveLength(2)
  })
})

describe('indexarValoresDeBloques', () => {
  it('indexa por negocio, bloque y campo', () => {
    const i = indexarValoresDeBloques([
      { negocio_id: 'n1', valores: { RUT: { numero_identificacion: '79876543' } } },
    ])
    expect(leerCampo(i, 'n1', 'RUT', 'numero_identificacion')).toBe('79876543')
  })

  it('recorta espacios y descarta valores vacios', () => {
    const i = indexarValoresDeBloques([
      { negocio_id: 'n1', valores: { RUT: { cedula: '  79876543  ', otro: '   ' } } },
    ])
    expect(leerCampo(i, 'n1', 'RUT', 'cedula')).toBe('79876543')
    expect(leerCampo(i, 'n1', 'RUT', 'otro')).toBeNull()
  })

  it('un negocio sin valores no rompe ni contamina el indice', () => {
    const i = indexarValoresDeBloques([
      { negocio_id: 'n1', valores: null },
      { negocio_id: 'n2', valores: { RUT: { cedula: 'bbb' } } },
    ])
    expect(leerCampo(i, 'n1', 'RUT', 'cedula')).toBeNull()
    expect(leerCampo(i, 'n2', 'RUT', 'cedula')).toBe('bbb')
  })

  it('no mezcla el mismo campo entre bloques distintos', () => {
    const i = indexarValoresDeBloques([
      { negocio_id: 'n1', valores: { RUT: { numero: 'del-rut' }, Factura: { numero: 'de-la-factura' } } },
    ])
    expect(leerCampo(i, 'n1', 'RUT', 'numero')).toBe('del-rut')
    expect(leerCampo(i, 'n1', 'Factura', 'numero')).toBe('de-la-factura')
  })

  it('el servicio contratado llega igual que cualquier otro campo', () => {
    const i = indexarValoresDeBloques([
      { negocio_id: 'n1', valores: { 'Servicio contratado': { servicio: 'solo_upme' } } },
    ])
    expect(leerCampo(i, 'n1', 'Servicio contratado', 'servicio')).toBe('solo_upme')
  })
})
