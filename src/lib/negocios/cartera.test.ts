import { describe, it, expect } from 'vitest'
import { resumirCartera, type FilaCartera } from './cartera'

function fila(over: Partial<FilaCartera> = {}): FilaCartera {
  return {
    codigo: 'V0001',
    nombre: 'Caso',
    honorario: 1_000_000,
    honorario_recaudado: 0,
    saldo: 1_000_000,
    dias: 10,
    ...over,
  }
}

describe('resumirCartera', () => {
  it('nunca devuelve una cartera negativa, que era el defecto original', () => {
    // La cuenta vieja era `facturas - cobros`. Sin facturas daba el recaudo
    // historico en negativo: -$88.973.023 en SOENA. Aca lo cobrado de mas no
    // resta, porque `v_cartera_negocio` ya topa el saldo en cero.
    const r = resumirCartera([
      fila({ honorario: 500_000, honorario_recaudado: 900_000, saldo: 0 }),
      fila({ honorario: 500_000, honorario_recaudado: 800_000, saldo: 0 }),
    ])
    expect(r.carteraPendiente).toBe(0)
    expect(r.carteraNegocios).toBe(0)
    expect(r.honorarioAprobado).toBe(1_000_000)
    expect(r.honorarioRecaudado).toBe(1_700_000)
  })

  it('los numeros llegan como string desde Postgres y se suman igual', () => {
    const r = resumirCartera([
      fila({ honorario: '637500', honorario_recaudado: '0', saldo: '637500' }),
      fila({ honorario: '850000', honorario_recaudado: '212500', saldo: '637500' }),
    ])
    expect(r.carteraPendiente).toBe(1_275_000)
    expect(r.honorarioAprobado).toBe(1_487_500)
    expect(r.honorarioRecaudado).toBe(212_500)
  })

  it('un residuo por debajo de la tolerancia no es una deuda', () => {
    const r = resumirCartera([
      fila({ saldo: 999 }),
      fila({ saldo: 1_000 }),
      fila({ saldo: 1_001 }),
    ])
    expect(r.carteraNegocios).toBe(1)
    expect(r.carteraPendiente).toBe(1_001)
  })

  it('el universo de la tasa de cobro incluye a los que ya pagaron todo', () => {
    // Si el denominador solo contara a los deudores, la tasa de cobro de un
    // workspace al dia daria 0% en vez de 100%.
    const r = resumirCartera([
      fila({ honorario: 1_000_000, honorario_recaudado: 1_000_000, saldo: 0 }),
      fila({ honorario: 1_000_000, honorario_recaudado: 250_000, saldo: 750_000 }),
    ])
    expect(r.honorarioAprobado).toBe(2_000_000)
    expect(r.honorarioRecaudado).toBe(1_250_000)
    expect(r.carteraPendiente).toBe(750_000)
  })

  it('ordena del mas viejo al mas reciente, no del que mas debe', () => {
    const r = resumirCartera([
      fila({ codigo: 'V0300', saldo: 5_000_000, dias: 5 }),
      fila({ codigo: 'V0130', saldo: 637_500, dias: 260 }),
      fila({ codigo: 'V0200', saldo: 900_000, dias: 90 }),
    ])
    expect(r.detalle.map(d => d.negocioCodigo)).toEqual(['V0130', 'V0200', 'V0300'])
  })

  it('con la misma antiguedad desempata el monto mayor', () => {
    const r = resumirCartera([
      fila({ codigo: 'V0002', saldo: 637_500, dias: 40 }),
      fila({ codigo: 'V0001', saldo: 850_000, dias: 40 }),
    ])
    expect(r.detalle.map(d => d.negocioCodigo)).toEqual(['V0001', 'V0002'])
  })

  it('vencida es lo que pasa de 30 dias, y el resto no suma', () => {
    const r = resumirCartera([
      fila({ saldo: 100_000, dias: 30 }),
      fila({ saldo: 200_000, dias: 31 }),
      fila({ saldo: 300_000, dias: 260 }),
    ])
    expect(r.carteraVencida).toBe(500_000)
    expect(r.carteraPendiente).toBe(600_000)
  })

  it('sin fecha de creacion no se inventa antiguedad: va al final y no cuenta como vencida', () => {
    const r = resumirCartera([
      fila({ codigo: 'V0900', saldo: 400_000, dias: null }),
      fila({ codigo: 'V0100', saldo: 100_000, dias: 12 }),
    ])
    expect(r.detalle.map(d => d.negocioCodigo)).toEqual(['V0100', 'V0900'])
    expect(r.carteraVencida).toBe(0)
  })

  it('un workspace sin negocios con precio aprobado no debe nada', () => {
    const r = resumirCartera([])
    expect(r).toEqual({
      carteraPendiente: 0,
      honorarioAprobado: 0,
      honorarioRecaudado: 0,
      carteraNegocios: 0,
      carteraVencida: 0,
      detalle: [],
    })
  })
})
