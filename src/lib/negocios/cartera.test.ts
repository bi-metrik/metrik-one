import { describe, it, expect } from 'vitest'
import { resumirCartera, vencimientoDeFila, type FilaCartera } from './cartera'

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

  it('un negocio cobrado por completo NO entra en la lista de deudores', () => {
    // Este era el top-5 del tablero financiero hasta el 2026-08-31: se armaba
    // desde `negocios` con `cobrado: 0` fijo y `cartera = precio_aprobado`, asi
    // que mostraba como deuda lo ya cobrado. Los 5 que salian en SOENA tenian
    // saldo real CERO — $2.868.000 de cartera inventada — mientras el total de
    // la misma tarjeta, que si venia de aca, decia otra cosa.
    const r = resumirCartera([
      fila({ codigo: 'V0253', honorario: 637_500, honorario_recaudado: 637_500, saldo: 0, dias: 300 }),
      fila({ codigo: 'V0415', honorario: 699_975, honorario_recaudado: 100_000, saldo: 599_975, dias: 195 }),
    ])
    expect(r.detalle.map(d => d.negocioCodigo)).toEqual(['V0415'])
    expect(r.detalle.reduce((s, d) => s + d.saldo, 0)).toBe(r.carteraPendiente)
  })

  it('el detalle trae honorario y recaudado, para que la tarjeta no los invente', () => {
    // La columna "Cobrado" del tablero estaba en cero duro. Si el dato no viaja
    // con la fila, quien pinta se lo tiene que inventar — y se lo invento.
    const r = resumirCartera([
      fila({ honorario: '765000', honorario_recaudado: '350906', saldo: '414094', dias: 174 }),
    ])
    expect(r.detalle[0]).toMatchObject({ honorario: 765_000, recaudado: 350_906, saldo: 414_094 })
    expect(r.detalle[0].honorario - r.detalle[0].recaudado).toBe(r.detalle[0].saldo)
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

  describe('con cronograma de cuotas', () => {
    // ALMA (A1 26 1), medido el 2026-09-27: 12 cuotas de $400.000, pagadas 3,
    // la 4 vencida el 15-sep. La vista vieja la daba como $3.600.000 vencidos a
    // 159 dias; lo vencido era una cuota de $400.000 con 12 dias de mora.
    const alma = fila({
      codigo: 'A1 26 1', honorario: '4800000', honorario_recaudado: '1200000', saldo: '3600000',
      dias: 159, con_cronograma: true, saldo_vencido: '400000', dias_mora: 12,
    })

    it('vencido es solo la cuota que ya paso su fecha, no todo el contrato', () => {
      expect(vencimientoDeFila(alma)).toEqual({
        conCronograma: true, vencido: 400_000, porVencer: 3_200_000, dias: 12,
      })
      const r = resumirCartera([alma])
      expect(r.carteraVencida).toBe(400_000)
      expect(r.carteraPendiente).toBe(3_600_000)
      expect(r.detalle[0]).toMatchObject({ saldo: 3_600_000, vencido: 400_000, porVencer: 3_200_000, dias: 12 })
    })

    it('al dia: nada vencido aunque el negocio tenga meses, y va al final de la lista', () => {
      const alDia = fila({ codigo: 'X', saldo: 3_200_000, dias: 200, con_cronograma: true, saldo_vencido: 0, dias_mora: null })
      const viejo = fila({ codigo: 'V', saldo: 100_000, dias: 40 })
      const r = resumirCartera([alDia, viejo])
      expect(r.carteraVencida).toBe(100_000)
      expect(r.detalle.map(d => d.negocioCodigo)).toEqual(['V', 'X'])
      expect(r.detalle[1]).toMatchObject({ vencido: 0, porVencer: 3_200_000, dias: 0 })
    })

    it('la regla de 30 dias no aplica: una cuota vencida hace 5 dias ya es vencida', () => {
      const r = resumirCartera([fila({ saldo: 800_000, dias: 10, con_cronograma: true, saldo_vencido: 100_000, dias_mora: 5 })])
      expect(r.carteraVencida).toBe(100_000)
    })

    it('lo vencido nunca pasa del saldo', () => {
      const v = vencimientoDeFila(fila({ saldo: 50_000, con_cronograma: true, saldo_vencido: 90_000, dias_mora: 3 }))
      expect(v).toMatchObject({ vencido: 50_000, porVencer: 0 })
    })

    it('sin las columnas nuevas (fila vieja) se comporta como antes', () => {
      expect(vencimientoDeFila(fila({ saldo: 300_000, dias: 31 }))).toEqual({
        conCronograma: false, vencido: 300_000, porVencer: 0, dias: 31,
      })
      expect(vencimientoDeFila(fila({ saldo: 300_000, dias: 30 })).vencido).toBe(0)
    })
  })
})
