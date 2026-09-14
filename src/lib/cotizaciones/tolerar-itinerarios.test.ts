import { describe, it, expect } from 'vitest'

import { faltanLasTablasDeItinerarios } from './tolerar-itinerarios'

describe('faltanLasTablasDeItinerarios', () => {
  it('reconoce el 42P01 de PostgreSQL sobre cualquiera de las dos tablas', () => {
    expect(faltanLasTablasDeItinerarios({
      code: '42P01',
      message: 'relation "public.cotizacion_itinerarios" does not exist',
    })).toBe(true)
    expect(faltanLasTablasDeItinerarios({
      code: '42P01',
      message: 'relation "public.itinerario_opciones" does not exist',
    })).toBe(true)
  })

  it('reconoce el PGRST205 de la caché de esquema', () => {
    // PostgREST contesta esto cuando ni siquiera intenta la consulta.
    expect(faltanLasTablasDeItinerarios({
      code: 'PGRST205',
      message: "Could not find the table 'public.cotizacion_itinerarios' in the schema cache",
    })).toBe(true)
  })

  it('NO tolera un 42P01 de OTRA tabla', () => {
    // Un `from()` mal escrito se leería como "todavía no hay itinerarios" y el
    // defecto real quedaría invisible. Ese es el fallo mudo que hay que evitar.
    expect(faltanLasTablasDeItinerarios({
      code: '42P01',
      message: 'relation "public.itinerarios_viejos" does not exist',
    })).toBe(false)
  })

  it('NO tolera otros errores sobre las mismas tablas', () => {
    // Un fallo de permisos sobre `cotizacion_itinerarios` es un problema real de RLS
    // o de grants: silenciarlo dejaría la pantalla vacía sin decir por qué.
    expect(faltanLasTablasDeItinerarios({
      code: '42501',
      message: 'permission denied for table cotizacion_itinerarios',
    })).toBe(false)
  })

  it('sin error no hay nada que tolerar', () => {
    expect(faltanLasTablasDeItinerarios(null)).toBe(false)
    expect(faltanLasTablasDeItinerarios(undefined)).toBe(false)
    expect(faltanLasTablasDeItinerarios({})).toBe(false)
  })
})
