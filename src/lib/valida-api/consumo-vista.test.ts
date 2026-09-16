import { describe, expect, it } from 'vitest'
import { porcentajeUsado, vistaConsumo } from './consumo-vista'
import type { ResumenValidaApi } from './tipos'

// Forma de la bolsa de 4D SOFT medida en Valida el 2026-09-16: 20.000 compradas y 6 consumidas.
const BOLSA_4D = {
  bolsa_id: '488aab80-0000-4000-8000-000000000000',
  secuencia: 1,
  estado: 'vigente' as const,
  bloqueada: false,
  activada_en: '2026-09-15T00:00:00Z',
  vence_en: '2027-03-15T00:00:00Z',
  dias_para_vencer: 180,
  consultas_compradas: 20000,
  consumidas: 6,
  saldo: 19994,
  precio_total: 1400000,
  pago_referencia: 'bold-TXRRP7Q95ZJ',
}

function resumen(over: Partial<ResumenValidaApi> = {}): ResumenValidaApi {
  return {
    cliente_id: '8c211c68-6c25-4beb-b364-c91c284d6379',
    consumo: { modalidad: 'bolsa', bolsa: BOLSA_4D },
    bolsa_en_espera: null,
    bolsas: [{ ...BOLSA_4D, estado: 'vigente', cerrada_en: null }],
    renovacion: { estado: 'sin_suscripcion' },
    ...over,
  }
}

describe('porcentajeUsado', () => {
  it('6 de 20.000 redondea a 0 %, no a «sin datos»', () => {
    expect(porcentajeUsado(6, 20000)).toBe(0)
  })

  it('sin consultas compradas no hay porcentaje: null, no 0', () => {
    expect(porcentajeUsado(0, 0)).toBeNull()
  })

  it('nunca pasa de 100', () => {
    expect(porcentajeUsado(25, 20)).toBe(100)
  })
})

describe('vistaConsumo', () => {
  it('la bolsa de 4D SOFT: saldo, vencimiento y sin corte', () => {
    const v = vistaConsumo(resumen())
    expect(v.tipo).toBe('bolsa')
    if (v.tipo !== 'bolsa') return
    expect(v.vigente).toMatchObject({ compradas: 20000, consumidas: 6, saldo: 19994, cortada: false })
    // La vigente no se repite en el historial.
    expect(v.historial).toHaveLength(0)
  })

  it('una bolsa agotada se muestra cortada: la API ya responde 402', () => {
    const v = vistaConsumo(resumen({ consumo: { modalidad: 'bolsa', bolsa: { ...BOLSA_4D, estado: 'agotada', saldo: 0 } } }))
    expect(v.tipo === 'bolsa' && v.vigente?.cortada).toBe(true)
  })

  it('un cliente de plan mensual no tiene bolsa: no se dice «bolsa agotada»', () => {
    expect(vistaConsumo(resumen({ consumo: { modalidad: 'mensual', bolsa: null } })).tipo).toBe('mensual')
  })

  it('sin consumo, sin_datos', () => {
    expect(vistaConsumo(resumen({ consumo: null })).tipo).toBe('sin_datos')
  })
})
