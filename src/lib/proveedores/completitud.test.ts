import { describe, expect, it } from 'vitest'

import { ciudadEsDepartamento, faltasDeFicha, fichaCompleta, quitarNotaCiudadPorConfirmar, tieneNotaCiudadPorConfirmar } from './completitud'

const ficha = (extra: Partial<Parameters<typeof faltasDeFicha>[0]> = {}) => ({ tipo_proveedor: 'hotel', ciudad: 'Cartagena', pais: 'CO', departamento: null, notas: null, ...extra })

describe('ficha completa para cotizar', () => {
  it('ciudad, país y tipo: completa', () => {
    expect(fichaCompleta(ficha())).toBe(true)
    expect(fichaCompleta(ficha({ ciudad: 'Madrid', pais: 'ES' }))).toBe(true)
    expect(fichaCompleta(ficha({ ciudad: 'Bogotá' }))).toBe(true)
  })

  it('sin ciudad, sin país o con tipo «Otro»: le falta', () => {
    expect(faltasDeFicha(ficha({ ciudad: '  ', pais: null, tipo_proveedor: 'otro' })).map((f) => f.campo)).toEqual(['ciudad', 'pais', 'tipo'])
  })

  it('la nota «Ciudad por confirmar» la deja por clasificar, se escriba como se escriba', () => {
    expect(faltasDeFicha(ficha({ notas: 'Importado.\nCIUDAD POR CONFIRMAR (Airtable decía Cundinamarca)' }))).toEqual([{ campo: 'ciudad', texto: 'La ciudad está por confirmar' }])
    expect(tieneNotaCiudadPorConfirmar('ciudad por confirmar')).toBe(true)
    expect(tieneNotaCiudadPorConfirmar('Ciudad confirmada')).toBe(false)
  })

  it('un departamento escrito como ciudad no es un municipio', () => {
    expect(faltasDeFicha(ficha({ ciudad: 'Quindío' }))[0]?.texto).toMatch(/departamento/)
    expect(faltasDeFicha(ficha({ ciudad: 'Cundinamarca' }))[0]?.texto).toMatch(/departamento/)
    // Fuera de Colombia no se juzga.
    expect(fichaCompleta(ficha({ ciudad: 'Panamá', pais: 'PA' }))).toBe(true)
  })

  it('un nombre que es departamento y municipio vale si el departamento lo confirma', () => {
    expect(ciudadEsDepartamento('Caldas', null)).toBe(true)
    expect(ciudadEsDepartamento('Caldas', 'Caldas')).toBe(true) // el municipio Caldas está en Antioquia
    expect(ciudadEsDepartamento('Caldas', 'Antioquia')).toBe(false)
    expect(ciudadEsDepartamento('Arauca', 'Arauca')).toBe(false)
    expect(ciudadEsDepartamento('San Andrés', null)).toBe(false)
    expect(ciudadEsDepartamento('Medellín', null)).toBe(false)
  })

  it('quitar la nota deja el resto de las notas', () => {
    expect(quitarNotaCiudadPorConfirmar('Ciudad por confirmar\nPide tarifas por correo')).toBe('Pide tarifas por correo')
    expect(quitarNotaCiudadPorConfirmar('[Ciudad por confirmar] Airtable decía Boyacá')).toBe('Airtable decía Boyacá')
    expect(quitarNotaCiudadPorConfirmar('Ciudad por confirmar')).toBeNull()
  })
})
