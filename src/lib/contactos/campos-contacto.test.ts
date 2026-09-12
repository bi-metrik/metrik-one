import { describe, it, expect } from 'vitest'
import {
  esCampoNativo,
  leerCampo,
  separarCampos,
  estadoAutorizacion,
  AUTORIZACION_SLUG,
  AUTORIZACION_FECHA_SLUG,
  type ValoresContacto,
} from './campos-contacto'

const base: ValoresContacto = {
  nombre: 'Parmenio Tacha',
  email: null,
  telefono: '3001234567',
  rol: null,
  segmento: null,
  custom_data: { destinos_preferidos: 'Europa', autorizacion_datos: true },
}

describe('esCampoNativo', () => {
  it('reconoce las columnas de contactos y nada mas', () => {
    expect(esCampoNativo('nombre')).toBe(true)
    expect(esCampoNativo('telefono')).toBe(true)
    expect(esCampoNativo('destinos_preferidos')).toBe(false)
  })

  it('segmento y rol NO son escribibles: son el embudo y el rol de venta, con CHECK propio', () => {
    // Un "leisure / corporativo" configurado sobre `segmento` rebota contra
    // `contactos_segmento_check`, y si pasara estaria moviendo al contacto de etapa
    // del funnel desde dentro de un viaje.
    expect(esCampoNativo('segmento')).toBe(false)
    expect(esCampoNativo('rol')).toBe(false)
  })
})

describe('leerCampo', () => {
  it('lee columna nativa y clave de custom_data con la misma llamada', () => {
    expect(leerCampo(base, 'telefono')).toBe('3001234567')
    expect(leerCampo(base, 'destinos_preferidos')).toBe('Europa')
  })

  it('devuelve null tanto para columna vacia como para clave inexistente', () => {
    expect(leerCampo(base, 'email')).toBeNull()
    expect(leerCampo(base, 'frecuencia_viaje')).toBeNull()
  })
})

describe('separarCampos', () => {
  it('manda cada valor a su destino', () => {
    const { nativos, custom } = separarCampos({
      telefono: '3009999999',
      destinos_preferidos: 'Caribe',
    })
    expect(nativos).toEqual({ telefono: '3009999999' })
    expect(custom).toEqual({ destinos_preferidos: 'Caribe' })
  })

  it('convierte el string vacio de un nativo en null, no en cadena vacia', () => {
    const { nativos } = separarCampos({ email: '' })
    expect(nativos.email).toBeNull()
  })

  it('NO deja borrar el nombre: es la unica columna NOT NULL de contactos', () => {
    const { nativos } = separarCampos({ nombre: '   ', telefono: '3001112222' })
    expect('nombre' in nativos).toBe(false)
    expect(nativos.telefono).toBe('3001112222')
  })

  it('un custom vacio SI se guarda: borrar un dato del perfil es una accion legitima', () => {
    const { custom } = separarCampos({ destinos_preferidos: '' })
    expect(custom.destinos_preferidos).toBe('')
  })
})

describe('estadoAutorizacion', () => {
  it('sin custom_data no hay autorizacion', () => {
    expect(estadoAutorizacion(null)).toEqual({ autorizado: false, fecha: null, autor: null })
    expect(estadoAutorizacion({})).toEqual({ autorizado: false, fecha: null, autor: null })
  })

  it('lee la marca y su fecha', () => {
    const e = estadoAutorizacion({
      [AUTORIZACION_SLUG]: true,
      [AUTORIZACION_FECHA_SLUG]: '2026-09-12T15:00:00.000Z',
    })
    expect(e.autorizado).toBe(true)
    expect(e.fecha).toBe('2026-09-12T15:00:00.000Z')
  })

  it('autorizado SIN fecha sigue siendo autorizado: la fecha es trazabilidad, no el permiso', () => {
    // Es el caso de los contactos migrados desde Airtable, que traen la marca sin estampa.
    const e = estadoAutorizacion({ [AUTORIZACION_SLUG]: true })
    expect(e.autorizado).toBe(true)
    expect(e.fecha).toBeNull()
  })

  it('un false explicito no autoriza', () => {
    expect(estadoAutorizacion({ [AUTORIZACION_SLUG]: false }).autorizado).toBe(false)
  })

  it('la fecha no se reporta si la marca no esta: sin autorizacion no hay fecha que mostrar', () => {
    const e = estadoAutorizacion({ [AUTORIZACION_FECHA_SLUG]: '2026-01-01T00:00:00.000Z' })
    expect(e.autorizado).toBe(false)
    expect(e.fecha).toBeNull()
  })
})
