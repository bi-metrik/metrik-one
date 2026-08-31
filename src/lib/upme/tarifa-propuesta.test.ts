import { describe, it, expect } from 'vitest'
import { fuenteDeLaTarifa, faltaConfirmarTarifa } from './tarifa-propuesta'

const base = { confirmada: 0, editadaAMano: null as number | null, autoCalculoHabilitado: false }

describe('fuenteDeLaTarifa', () => {
  it('la confirmada manda: es la que el sistema le cobra al cliente', () => {
    expect(fuenteDeLaTarifa({ ...base, confirmada: 701_812 })).toBe('confirmada')
  })

  it('la confirmada gana sobre una edicion a mano que dice otra cosa', () => {
    // El caso que motiva el orden: si ganara la edicion, el PDF imprimiria 500.000 y
    // la cartera cobraria 701.812 sobre el mismo negocio.
    expect(fuenteDeLaTarifa({ confirmada: 701_812, editadaAMano: 500_000, autoCalculoHabilitado: true }))
      .toBe('confirmada')
  })

  it('la confirmada gana tambien sobre el auto-calculo legacy', () => {
    expect(fuenteDeLaTarifa({ ...base, confirmada: 350_906, autoCalculoHabilitado: true }))
      .toBe('confirmada')
  })

  it('sin confirmada, respeta lo editado a mano', () => {
    expect(fuenteDeLaTarifa({ ...base, editadaAMano: 350_906 })).toBe('editada')
  })

  it('sin confirmada ni edicion, cae al auto-calculo si esta habilitado', () => {
    expect(fuenteDeLaTarifa({ ...base, autoCalculoHabilitado: true })).toBe('auto')
  })

  it('sin ninguna via, no hay tarifa (el PDF omite la linea, no la pinta en cero)', () => {
    expect(fuenteDeLaTarifa(base)).toBe('ninguna')
  })

  it('un cero no cuenta como respuesta en ninguna via', () => {
    // Es el estado real de SOENA antes del fix: el campo existia, en cero, en las 103
    // propuestas que lo llevaban. Tratarlo como valor imprimiria "$0" como si el
    // tramite fuera gratis.
    expect(fuenteDeLaTarifa({ confirmada: 0, editadaAMano: 0, autoCalculoHabilitado: false }))
      .toBe('ninguna')
  })

  it('un cero escrito a mano no tapa una tarifa confirmada real', () => {
    expect(fuenteDeLaTarifa({ confirmada: 701_812, editadaAMano: 0, autoCalculoHabilitado: false }))
      .toBe('confirmada')
  })

  it('valores no finitos o negativos se ignoran', () => {
    expect(fuenteDeLaTarifa({ ...base, confirmada: Number.NaN })).toBe('ninguna')
    expect(fuenteDeLaTarifa({ ...base, confirmada: -50 })).toBe('ninguna')
    expect(fuenteDeLaTarifa({ ...base, editadaAMano: -1 })).toBe('ninguna')
  })
})

describe('faltaConfirmarTarifa', () => {
  const tarifado = { usaModeloTarifa: true, servicioNiegaTarifa: false, tarifaUpme: 0 }

  it('frena cuando el caso lleva tarifa y todavia no la confirman', () => {
    expect(faltaConfirmarTarifa(tarifado)).toBe(true)
  })

  it('NO frena a un solo IVA: su tarifa en cero es la respuesta correcta', () => {
    // El caso que motiva la funcion. Antes de subir `servicio_contratado` a Propuesta
    // este escenario no podia existir: el bloque vivia una etapa despues y siempre
    // llegaba vacio, asi que todo cero se leia como dato faltante.
    expect(faltaConfirmarTarifa({ ...tarifado, servicioNiegaTarifa: true })).toBe(false)
  })

  it('no frena cuando la tarifa ya esta confirmada', () => {
    expect(faltaConfirmarTarifa({ ...tarifado, tarifaUpme: 701_812 })).toBe(false)
  })

  it('un workspace sin modelo de tarifa nunca se frena', () => {
    expect(faltaConfirmarTarifa({ ...tarifado, usaModeloTarifa: false })).toBe(false)
  })

  it('una tarifa no finita o negativa no cuenta como confirmada', () => {
    expect(faltaConfirmarTarifa({ ...tarifado, tarifaUpme: Number.NaN })).toBe(true)
    expect(faltaConfirmarTarifa({ ...tarifado, tarifaUpme: -1 })).toBe(true)
  })

  it('el servicio que niega la tarifa manda sobre el valor: no frena aunque venga en cero', () => {
    expect(faltaConfirmarTarifa({ usaModeloTarifa: true, servicioNiegaTarifa: true, tarifaUpme: 0 }))
      .toBe(false)
  })
})
