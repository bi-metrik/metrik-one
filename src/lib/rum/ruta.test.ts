import { describe, expect, it } from 'vitest'
import { normalizarRuta } from './ruta'

describe('normalizarRuta', () => {
  it('UUID y numeros pasan a [id]', () => {
    expect(normalizarRuta('/negocios/7f3c2a10-1b2c-4d5e-8f90-123456789abc')).toBe('/negocios/[id]')
    expect(normalizarRuta('/calidad/llamada/12345')).toBe('/calidad/llamada/[id]')
    expect(normalizarRuta('/negocios/7f3c2a10-1b2c-4d5e-8f90-123456789abc/cotizacion/98')).toBe(
      '/negocios/[id]/cotizacion/[id]',
    )
  })

  it('sin query string ni hash', () => {
    expect(normalizarRuta('/vinculacion/x?token=secreto#y')).toBe('/vinculacion/x')
    expect(normalizarRuta('/negocios?buscar=Maria%20Perez')).toBe('/negocios')
  })

  it('los params de Next ponen el nombre del segmento, tambien para slugs sin digitos', () => {
    expect(normalizarRuta('/equipo/vendedor/maria-perez', { slug: 'maria-perez' })).toBe('/equipo/vendedor/[slug]')
    expect(normalizarRuta('/negocios/abc', { id: 'abc' })).toBe('/negocios/[id]')
    expect(normalizarRuta('/x/a/b', { resto: ['a', 'b'] })).toBe('/x/[resto]/[resto]')
  })

  it('correos, espacios y tokens largos no viajan aunque no haya params', () => {
    expect(normalizarRuta('/directorio/ana@correo.co')).toBe('/directorio/[id]')
    expect(normalizarRuta('/muro/abcdefghijklmnopqrstuvwxyzabcdefgh')).toBe('/muro/[id]')
    expect(normalizarRuta('/directorio/Ana%20Perez')).toBe('/directorio/[id]')
  })

  it('las rutas fijas quedan como estan (en minuscula)', () => {
    expect(normalizarRuta('/')).toBe('/')
    expect(normalizarRuta('/tableros')).toBe('/tableros')
    expect(normalizarRuta('/directorio/empresas')).toBe('/directorio/empresas')
  })

  it('es idempotente: lo ya normalizado no cambia', () => {
    expect(normalizarRuta('/negocios/[id]/cotizacion/[cotId]')).toBe('/negocios/[id]/cotizacion/[cotId]')
  })

  it('tope de segmentos', () => {
    const larga = '/' + Array.from({ length: 20 }, () => 'abc').join('/')
    expect(normalizarRuta(larga).split('/').filter(Boolean)).toHaveLength(8)
  })
})
