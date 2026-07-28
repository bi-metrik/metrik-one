import { describe, it, expect } from 'vitest'
import {
  leerMarcasDeMetadata,
  origenDesdeFuenteInteraccion,
  esMarcaCondicionValida,
} from './constants'
import { esOrigenNegocioValido, ORIGENES_NEGOCIO, ORIGEN_ALIANZA } from '@/lib/catalogos/constants'

describe('origenDesdeFuenteInteraccion', () => {
  it('un lead de Meta nace con origen meta', () => {
    expect(origenDesdeFuenteInteraccion('meta')).toBe('meta')
  })

  it('mapea los demas canales del catalogo de interacciones', () => {
    expect(origenDesdeFuenteInteraccion('web')).toBe('web_organico')
    expect(origenDesdeFuenteInteraccion('whatsapp')).toBe('contacto_directo')
    expect(origenDesdeFuenteInteraccion('manual')).toBe('contacto_directo')
  })

  it('nunca deja el negocio sin origen ante un canal desconocido o nulo', () => {
    expect(origenDesdeFuenteInteraccion(null)).toBe('otro')
    expect(origenDesdeFuenteInteraccion(undefined)).toBe('otro')
    expect(origenDesdeFuenteInteraccion('canal_que_no_existe')).toBe('otro')
  })

  it('todo lo que devuelve pertenece al catalogo de origenes', () => {
    for (const fuente of ['meta', 'web', 'whatsapp', 'manual', 'raro', null]) {
      expect(esOrigenNegocioValido(origenDesdeFuenteInteraccion(fuente))).toBe(true)
    }
  })
})

describe('esOrigenNegocioValido', () => {
  it('acepta los valores del catalogo y rechaza el resto', () => {
    for (const o of ORIGENES_NEGOCIO) expect(esOrigenNegocioValido(o.value)).toBe(true)
    expect(esOrigenNegocioValido('inventado')).toBe(false)
    expect(esOrigenNegocioValido('')).toBe(false)
    expect(esOrigenNegocioValido(null)).toBe(false)
    expect(esOrigenNegocioValido(undefined)).toBe(false)
  })

  it('alianza es un origen del catalogo', () => {
    expect(esOrigenNegocioValido(ORIGEN_ALIANZA)).toBe(true)
  })
})

describe('leerMarcasDeMetadata', () => {
  it('sin marcas devuelve lista vacia', () => {
    expect(leerMarcasDeMetadata(null)).toEqual([])
    expect(leerMarcasDeMetadata({})).toEqual([])
    expect(leerMarcasDeMetadata({ marcas: null })).toEqual([])
  })

  it('lee una marca completa', () => {
    const marcas = leerMarcasDeMetadata({
      marcas: [
        {
          tipo: 'descuento',
          nota: '20% por volumen',
          marcado_por_id: 'staff-1',
          marcado_por_nombre: 'Deisy',
          marcado_en: '2026-07-27T10:00:00.000Z',
        },
      ],
    })
    expect(marcas).toHaveLength(1)
    expect(marcas[0].tipo).toBe('descuento')
    expect(marcas[0].nota).toBe('20% por volumen')
    expect(marcas[0].marcado_por_nombre).toBe('Deisy')
  })

  it('descarta items con tipo invalido sin romper el resto', () => {
    const marcas = leerMarcasDeMetadata({
      marcas: [
        { tipo: 'tipo_que_no_existe' },
        { tipo: 'sin_honorario', marcado_en: '2026-07-27T10:00:00.000Z' },
        'basura',
        null,
      ],
    })
    expect(marcas.map((m) => m.tipo)).toEqual(['sin_honorario'])
  })

  it('normaliza nota vacia a null y tolera campos ausentes', () => {
    const [marca] = leerMarcasDeMetadata({ marcas: [{ tipo: 'otro', nota: '   ' }] })
    expect(marca.nota).toBeNull()
    expect(marca.marcado_por_id).toBeNull()
    expect(marca.marcado_por_nombre).toBeNull()
    expect(marca.marcado_en).toBe('')
  })

  it('si metadata.marcas no es arreglo, no revienta la lista de negocios', () => {
    expect(leerMarcasDeMetadata({ marcas: 'descuento' })).toEqual([])
    expect(leerMarcasDeMetadata({ marcas: { tipo: 'descuento' } })).toEqual([])
  })
})

describe('esMarcaCondicionValida', () => {
  it('acepta solo el catalogo de marcas', () => {
    expect(esMarcaCondicionValida('descuento')).toBe(true)
    expect(esMarcaCondicionValida('sin_honorario')).toBe(true)
    expect(esMarcaCondicionValida('otro')).toBe(true)
    expect(esMarcaCondicionValida('gratis_total')).toBe(false)
    expect(esMarcaCondicionValida(undefined)).toBe(false)
  })
})
