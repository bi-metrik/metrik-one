import { describe, it, expect } from 'vitest'
import { indexarCamposDeBloques, leerCampo, type FilaCampo } from './campos-de-bloques'

const fila = (p: Partial<FilaCampo>): FilaCampo => ({
  negocio_id: 'n1',
  bloque_nombre: 'RUT',
  campo: 'numero_identificacion',
  valor: '79876543',
  ...p,
})

describe('indexarCamposDeBloques', () => {
  it('indexa por negocio, bloque y campo', () => {
    const i = indexarCamposDeBloques([fila({})])
    expect(leerCampo(i, 'n1', 'RUT', 'numero_identificacion')).toBe('79876543')
  })

  it('la primera instancia con valor gana sobre las copias posteriores', () => {
    const i = indexarCamposDeBloques([
      fila({ valor: '79876543' }),
      fila({ valor: '11111111' }),
    ])
    expect(leerCampo(i, 'n1', 'RUT', 'numero_identificacion')).toBe('79876543')
  })

  it('una copia vacia no tapa el valor que viene despues', () => {
    const i = indexarCamposDeBloques([
      fila({ valor: '   ' }),
      fila({ valor: '79876543' }),
    ])
    expect(leerCampo(i, 'n1', 'RUT', 'numero_identificacion')).toBe('79876543')
  })

  it('recorta los espacios del valor', () => {
    const i = indexarCamposDeBloques([fila({ valor: '  FISA000011232  ' })])
    expect(leerCampo(i, 'n1', 'RUT', 'numero_identificacion')).toBe('FISA000011232')
  })

  it('no mezcla negocios distintos', () => {
    const i = indexarCamposDeBloques([
      fila({ negocio_id: 'n1', valor: 'aaa' }),
      fila({ negocio_id: 'n2', valor: 'bbb' }),
    ])
    expect(leerCampo(i, 'n1', 'RUT', 'numero_identificacion')).toBe('aaa')
    expect(leerCampo(i, 'n2', 'RUT', 'numero_identificacion')).toBe('bbb')
  })

  it('no mezcla campos del mismo nombre en bloques distintos', () => {
    const i = indexarCamposDeBloques([
      fila({ bloque_nombre: 'RUT', campo: 'numero', valor: 'del-rut' }),
      fila({ bloque_nombre: 'Factura emitida', campo: 'numero', valor: 'de-la-factura' }),
    ])
    expect(leerCampo(i, 'n1', 'RUT', 'numero')).toBe('del-rut')
    expect(leerCampo(i, 'n1', 'Factura emitida', 'numero')).toBe('de-la-factura')
  })

  it('ignora filas incompletas en vez de indexar basura', () => {
    const i = indexarCamposDeBloques([
      { negocio_id: '', bloque_nombre: 'RUT', campo: 'x', valor: 'v' },
      { negocio_id: 'n1', bloque_nombre: '', campo: 'x', valor: 'v' },
      { negocio_id: 'n1', bloque_nombre: 'RUT', campo: '', valor: 'v' },
    ])
    expect(i).toEqual({})
  })

  it('un bloque o campo sin configurar devuelve null, no revienta', () => {
    const i = indexarCamposDeBloques([fila({})])
    expect(leerCampo(i, 'n1', undefined, 'numero_identificacion')).toBeNull()
    expect(leerCampo(i, 'n1', 'RUT', undefined)).toBeNull()
    expect(leerCampo(i, 'desconocido', 'RUT', 'numero_identificacion')).toBeNull()
  })
})
