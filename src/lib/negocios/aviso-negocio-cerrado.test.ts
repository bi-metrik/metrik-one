import { describe, expect, it } from 'vitest'
import { avisoNegocioCerrado } from './aviso-negocio-cerrado'
import { configSeguimiento } from './seguimiento'

describe('H10-2 · la ficha marca el negocio perdido', () => {
  it('perdido con seguimiento: título, motivo de la línea y fecha', () => {
    const a = avisoNegocioCerrado({ estado: 'perdido', razonCierre: 'competencia', closedAt: '2026-10-29T18:46:00Z', seguimiento: configSeguimiento({ seguimiento: { activo: true } }) })
    expect(a).toEqual({ titulo: 'Negocio perdido', detalle: 'Motivo: Se fue con otra agencia · cerrado el 29 oct' })
  })

  it('abierto: nada', () => {
    expect(avisoNegocioCerrado({ estado: 'abierto', razonCierre: null, closedAt: null, seguimiento: configSeguimiento(null) })).toBeNull()
  })
})
