import { describe, expect, it } from 'vitest'

import { capitalizacionNormal, incluyeDeFila, mismoServicio, nombreDeServicio, textoIncluye } from './nombre-de-tarifa'

// Prueba del #1229, punto 2. Nombres FICTICIOS.
describe('capitalización normal', () => {
  it('lo escrito todo en mayúscula pasa a nombre; los conectores en minúscula', () => {
    expect(capitalizacionNormal('PLAYA BLANCA')).toBe('Playa Blanca')
    expect(capitalizacionNormal('ISLAS DEL ROSARIO')).toBe('Islas del Rosario')
    expect(capitalizacionNormal('CAÑÓN DEL RÍO')).toBe('Cañón del Río')
  })

  it('las siglas y los números se quedan', () => {
    expect(capitalizacionNormal('TOUR 4X4 VIP')).toBe('Tour 4X4 VIP')
    expect(capitalizacionNormal('PASADÍA CON BBQ')).toBe('Pasadía con BBQ')
    expect(capitalizacionNormal('PARQUE II')).toBe('Parque II')
  })

  it('un texto con minúsculas se respeta tal cual', () => {
    expect(capitalizacionNormal('Playa Blanca con almuerzo')).toBe('Playa Blanca con almuerzo')
    expect(capitalizacionNormal('tour de BAHÍA')).toBe('tour de BAHÍA')
  })

  it('como oración: solo la primera en mayúscula', () => {
    expect(capitalizacionNormal('CON ALMUERZO Y TRANSPORTE', 'oracion')).toBe('Con almuerzo y transporte')
  })
})

describe('el nombre completo del servicio', () => {
  it('categoría + plan pegado («con …») + modalidad', () => {
    expect(nombreDeServicio({ categoria: 'PLAYA BLANCA', plan: 'CON ALMUERZO' })).toBe('Playa Blanca con almuerzo')
    expect(nombreDeServicio({ categoria: 'Isla Ficticia', plan: 'Pasadía', modalidad: 'privado' })).toBe('Isla Ficticia · Pasadía (privado)')
  })

  it('no repite el plan que ya dice la categoría; sin categoría, el plan', () => {
    expect(nombreDeServicio({ categoria: 'Tour con almuerzo', plan: 'con almuerzo' })).toBe('Tour con almuerzo')
    expect(nombreDeServicio({ categoria: null, plan: 'Todo incluido' })).toBe('Todo incluido')
    expect(nombreDeServicio({ categoria: null, plan: null })).toBeNull()
  })
})

describe('lo que incluye la fila', () => {
  const tarifario = { planes: [{ codigo: 'CA', nombre: 'con almuerzo', incluye: ['ALMUERZO TÍPICO', 'Transporte en lancha'] }] }

  it('del plan que la define (por código o nombre), sin repetir, y de una nota «Incluye …»', () => {
    expect(incluyeDeFila({ plan: 'CA', nota: 'Incluye: guía, transporte en lancha' }, tarifario)).toEqual(['Almuerzo típico', 'Transporte en lancha', 'guía'])
    expect(incluyeDeFila({ plan: 'Con Almuerzo' }, tarifario)).toEqual(['Almuerzo típico', 'Transporte en lancha'])
  })

  it('una nota que no empieza por «Incluye» no sale al cliente', () => {
    expect(incluyeDeFila({ nota: 'derivado: el adulto desde 11 años' }, tarifario)).toEqual([])
  })

  it('el texto para el documento', () => {
    expect(textoIncluye(['Almuerzo típico', 'Transporte en lancha', 'guía'])).toBe('Incluye: almuerzo típico, transporte en lancha y guía.')
    expect(textoIncluye([])).toBe('')
  })
})

describe('el mismo servicio', () => {
  const f = (x: Partial<{ categoria: string; plan: string; ocupacion: string; modalidad: string }>) => ({ categoria: null, plan: null, ocupacion: null, establecimiento: null, modalidad: null, ...x })
  it('difieren en pasajero o temporada: sí; otra actividad, otro plan, otra modalidad u otra ocupación: no', () => {
    expect(mismoServicio([f({ categoria: 'Tour', ocupacion: 'doble' }), f({ categoria: 'TOUR' })])).toBe(true)
    expect(mismoServicio([f({ categoria: 'Tour A' }), f({ categoria: 'Tour B' })])).toBe(false)
    expect(mismoServicio([f({ categoria: 'Tour', plan: 'Con almuerzo' }), f({ categoria: 'Tour' })])).toBe(false)
    expect(mismoServicio([f({ categoria: 'Tour', modalidad: 'privado' }), f({ categoria: 'Tour', modalidad: 'compartido' })])).toBe(false)
    expect(mismoServicio([f({ categoria: 'Estándar', ocupacion: 'doble' }), f({ categoria: 'Estándar', ocupacion: 'triple' })])).toBe(false)
  })
})
