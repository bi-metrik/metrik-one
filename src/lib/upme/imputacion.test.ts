import { describe, it, expect } from 'vitest'
import { imputarCobros, techosDelNegocio, type CobroEntrada } from './imputacion'

// Cifras reales de SOENA (2026-08-11) para que la prueba hable el idioma del negocio:
// honorario aprobado tipico $637.500 y tarifa UPME confirmada $701.812.
const HONORARIO = 637_500
const TARIFA = 701_812

function cobros(...montos: number[]): CobroEntrada[] {
  return montos.map((monto, i) => ({ id: `c${i + 1}`, monto }))
}

describe('techosDelNegocio', () => {
  it('Plan 1 parte el honorario en dos tramos iguales', () => {
    const t = techosDelNegocio(HONORARIO, 1, TARIFA, true)
    expect(t.tramo1).toBe(318_750)
    expect(t.tramo2).toBe(318_750)
    expect(t.tarifa).toBe(TARIFA)
    expect(t.sinTecho).toBe(false)
  })

  it('Plan 2 tiene UN solo tramo: el segundo no existe, no es cero "pendiente"', () => {
    const t = techosDelNegocio(HONORARIO, 2, TARIFA, true)
    expect(t.tramo1).toBe(HONORARIO)
    expect(t.tramo2).toBe(0)
  })

  it('sin plan declarado se comporta como un solo tramo', () => {
    expect(techosDelNegocio(HONORARIO, null, 0, true).tramo1).toBe(HONORARIO)
  })

  it('sin valor declarado NO pone techo en cero: marca sinTecho', () => {
    const t = techosDelNegocio(null, 2, TARIFA, true)
    expect(t.sinTecho).toBe(true)
  })
})

describe('imputarCobros — el orden es honorario, luego tarifa, luego excedente', () => {
  it('Plan 1: un pago de 50% + tarifa NO se lee como adelanto del tramo 2', () => {
    // Es el caso que rompia con la tarifa tratada como "sobrante": los 5 negocios de
    // Plan 1 medidos en produccion tienen el primer pago por encima de la mitad.
    const t = techosDelNegocio(HONORARIO, 1, TARIFA, true)
    const [r] = imputarCobros(t, cobros(318_750 + TARIFA))
    expect(r.aTramo1).toBe(318_750)
    expect(r.aTramo2).toBe(0)
    expect(r.aTarifa).toBe(TARIFA)
    expect(r.excedente).toBe(0)
    expect(r.completaTramo1).toBe(true)
    expect(r.completaTramo2).toBe(false)
  })

  it('Plan 2 en cinco transferencias: el hito cae en la que COMPLETA, no en la primera', () => {
    const t = techosDelNegocio(HONORARIO, 2, 0, true)
    const parte = HONORARIO / 5
    const r = imputarCobros(t, cobros(parte, parte, parte, parte, parte))
    expect(r.map((x) => x.completaTramo1)).toEqual([false, false, false, false, true])
    expect(r.reduce((s, x) => s + x.aTramo1, 0)).toBe(HONORARIO)
  })

  it('el hito se marca UNA sola vez, aunque sigan entrando pagos', () => {
    const t = techosDelNegocio(HONORARIO, 2, TARIFA, true)
    const r = imputarCobros(t, cobros(HONORARIO, TARIFA))
    expect(r.filter((x) => x.completaTramo1)).toHaveLength(1)
    expect(r[1].aTarifa).toBe(TARIFA)
  })

  it('Plan 1 completo: dos hitos distintos, cada uno en su transaccion', () => {
    const t = techosDelNegocio(HONORARIO, 1, 0, true)
    const r = imputarCobros(t, cobros(318_750, 318_750))
    expect(r[0].completaTramo1).toBe(true)
    expect(r[0].completaTramo2).toBe(false)
    expect(r[1].completaTramo1).toBe(false)
    expect(r[1].completaTramo2).toBe(true)
  })

  it('lo que pasa del honorario y de la tarifa es excedente, no ingreso', () => {
    const t = techosDelNegocio(HONORARIO, 2, TARIFA, true)
    const [r] = imputarCobros(t, cobros(HONORARIO + TARIFA + 50_000))
    expect(r.aTramo1).toBe(HONORARIO)
    expect(r.aTarifa).toBe(TARIFA)
    expect(r.excedente).toBe(50_000)
  })

  it('el caso real de V0256: el cobro DUPLICADO cae entero en excedente', () => {
    // Dos filas identicas de $510.000 (misma fecha, misma referencia, mismo split_id)
    // + la tarifa. El segundo $510.000 no es ingreso de nadie.
    const t = techosDelNegocio(510_000, 2, 701_812, true)
    const r = imputarCobros(t, cobros(510_000, 510_000, 701_812))
    expect(r[0].aTramo1).toBe(510_000)
    expect(r[1].aTramo1).toBe(0)
    expect(r[1].aTarifa).toBe(510_000) // llena la cuenta de tarifa primero
    expect(r[2].aTarifa).toBe(191_812)
    expect(r[2].excedente).toBe(510_000)
    const totalExcedente = r.reduce((s, x) => s + x.excedente, 0)
    expect(totalExcedente).toBe(510_000)
  })

  it('sin techo declarado cuenta TODO como tramo 1 (ausencia de dato no es cero)', () => {
    const t = techosDelNegocio(null, null, null, true)
    const [r] = imputarCobros(t, cobros(1_000_000))
    expect(r.aTramo1).toBe(1_000_000)
    expect(r.excedente).toBe(0)
  })

  it('un monto negativo va entero a excedente y NO libera techo ya consumido', () => {
    const t = techosDelNegocio(HONORARIO, 2, 0, true)
    const r = imputarCobros(t, cobros(HONORARIO, -100_000, 100_000))
    expect(r[1].excedente).toBe(-100_000)
    expect(r[1].aTramo1).toBe(0)
    // El tercero NO vuelve a llenar el tramo: ya estaba completo.
    expect(r[2].aTramo1).toBe(0)
    expect(r[2].excedente).toBe(100_000)
  })

  it('un cobro anulado (monto 0) no mueve ninguna cuenta ni marca hitos', () => {
    const t = techosDelNegocio(HONORARIO, 2, 0, true)
    const r = imputarCobros(t, cobros(0, HONORARIO))
    expect(r[0]).toMatchObject({ aTramo1: 0, aTarifa: 0, excedente: 0, completaTramo1: false })
    expect(r[1].completaTramo1).toBe(true)
  })

  it('la suma de las cuatro cuentas es SIEMPRE el monto cobrado', () => {
    // La invariante que hace auditable el P&L: nada se pierde ni se inventa al repartir.
    const t = techosDelNegocio(HONORARIO, 1, TARIFA, true)
    const entradas = cobros(200_000, 400_000, 350_000, 900_000)
    const r = imputarCobros(t, entradas)
    r.forEach((x, i) => {
      expect(x.aTramo1 + x.aTramo2 + x.aTarifa + x.excedente).toBe(entradas[i].monto)
    })
  })
})

describe('el modelo topado es OPT-IN — sin declararlo, nada se topa', () => {
  it('sin declaracion, un cobro MAYOR al valor sigue siendo ingreso propio entero', () => {
    // El caso de ana-demo: $900.000 por encima del valor del negocio. En un workspace
    // sin el modelo honorario+tarifa eso no es plata ajena, es el precio desactualizado.
    // Aplicarle el techo le borraba ingreso real del P&L.
    const t = techosDelNegocio(35_800_000, null, null) // sin el flag
    const [r] = imputarCobros(t, cobros(36_700_000))
    expect(r.aTramo1).toBe(36_700_000)
    expect(r.excedente).toBe(0)
    expect(r.aTarifa).toBe(0)
  })

  it('el mismo negocio CON el modelo declarado si separa el excedente', () => {
    const t = techosDelNegocio(35_800_000, null, null, true)
    const [r] = imputarCobros(t, cobros(36_700_000))
    expect(r.aTramo1).toBe(35_800_000)
    expect(r.excedente).toBe(900_000)
  })

  it('sin declaracion no hay hitos de tramo: no existe "completar" lo que no tiene techo', () => {
    const t = techosDelNegocio(500_000, 1, 100_000)
    const r = imputarCobros(t, cobros(250_000, 250_000))
    expect(r.every((x) => !x.completaTramo1 && !x.completaTramo2)).toBe(true)
  })
})
