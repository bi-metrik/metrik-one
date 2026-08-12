import { describe, it, expect } from 'vitest'
import { casoListoParaFacturar, faltantesDelCaso } from './caso-listo'
import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'

const base = { faltan_factura: [] as string[], faltan_cliente: [] as string[], falta_saldo: 0 }

describe('casoListoParaFacturar', () => {
  it('con datos completos y el honorario recaudado, está listo', () => {
    expect(casoListoParaFacturar(base)).toBe(true)
  })

  it('un dato faltante del cliente lo saca de listos', () => {
    expect(casoListoParaFacturar({ ...base, faltan_cliente: ['email'] })).toBe(false)
  })

  it('un dato faltante de la factura lo saca de listos', () => {
    expect(casoListoParaFacturar({ ...base, faltan_factura: ['honorario aprobado'] })).toBe(false)
  })

  it('con saldo del honorario pendiente NO está listo', () => {
    // Es plata que no entró, no un dato que falte. Mostrarlo como listo haría que
    // la bandeja prometa una factura que el gate del servidor va a rechazar.
    expect(casoListoParaFacturar({ ...base, falta_saldo: 250_000 })).toBe(false)
  })

  it('un residuo por debajo de la materialidad no frena', () => {
    // Misma vara que los demás gates del producto: un remanente no cobrable en la
    // práctica no puede dejar un caso sin facturar para siempre.
    expect(casoListoParaFacturar({ ...base, falta_saldo: TOLERANCIA_SALDO_COP })).toBe(true)
    expect(casoListoParaFacturar({ ...base, falta_saldo: TOLERANCIA_SALDO_COP + 1 })).toBe(false)
  })

  it('el recibo del recaudo UPME NO entra en el criterio', () => {
    // Es otro documento y plata de un tercero: su falta no frena el honorario.
    expect(casoListoParaFacturar({ ...base, ...{ faltan_recibo: ['valor pagado a la UPME'] } })).toBe(true)
  })
})

describe('faltantesDelCaso', () => {
  it('no repite un faltante que aparece en las dos listas', () => {
    const f = faltantesDelCaso({ ...base, faltan_cliente: ['identificación'], faltan_factura: ['identificación'] })
    expect(f).toEqual(['identificación'])
  })

  it('nombra el recaudo pendiente como una falta más', () => {
    expect(faltantesDelCaso({ ...base, falta_saldo: 100_000 })).toContain('recaudo del honorario')
  })

  it('sin faltas, lista vacía', () => {
    expect(faltantesDelCaso(base)).toEqual([])
  })
})
