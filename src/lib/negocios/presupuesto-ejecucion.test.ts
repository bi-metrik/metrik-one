import { describe, it, expect } from 'vitest'
import {
  calcularPresupuestoPorRubro,
  asignarEjecutadoPorRubro,
  totalPresupuestado,
} from './presupuesto-ejecucion'

/**
 * Los datos de `COT-2026-0002` son filas REALES copiadas de producción el 2026-09-04
 * (workspace 971a4e80-e923-4a29-8730-f40b88e4be4e). Si algún día dejan de cuadrar, la
 * prueba envejeció: la cotización se editó. `cotizaciones.costo_total` de esa fila era
 * 56.479.070,02 y `valor_total` 118.960.698,00.
 *
 * Verificado el mismo día contra las 6 cotizaciones aceptadas de producción: en las 6,
 * `sum(sum(rubros) x cantidad)` excluyendo `es_ajuste` es exactamente `costo_total`.
 *
 * Mutaciones probadas sobre `presupuesto-ejecucion.ts` (2026-09-04), todas tumbaron
 * alguna prueba:
 *  - quitar `* cantidad` en la rama de rubros → 3 pruebas rojas
 *  - quitar `* cantidad` en la rama de fallback por subtotal → 1 roja
 *  - cambiar `if (item.es_ajuste) continue` por `if (false) continue` → 1 roja
 *  - cambiar `Number(item.cantidad) || 1` por `Number(item.cantidad) ?? 1` → 1 roja
 *  - quitar el `+ costoHoras` de `mo_propia` → 3 rojas
 *  - reemplazar (en vez de sumar) los gastos de `mano_de_obra` por `costoHoras` → 1 roja
 *  - dejar que un gasto cuente contra TODOS sus candidatos y no solo el primero → 1 roja
 *
 * Una novena mutacion NO tumbo ninguna prueba y por eso el codigo cambio en vez de la
 * prueba: quitar el guard `tiposPresentes.has(TIPO_RUBRO_HORAS_STAFF)` antes de sumar
 * las horas es indistinguible desde fuera, porque el `map` final recorre el presupuesto
 * y descarta solo lo que no esta. Se elimino el guard: una linea que ninguna prueba
 * puede defender es una linea que nadie sabe si sigue haciendo algo.
 */

// COT-2026-0002 — ítem "BARANDA TELESCOPICA", 13 rubros, cantidad 794.
const RUBROS_BARANDA = [
  { tipo: 'materiales', valor_total: 10890 },
  { tipo: 'servicios_prof', valor_total: 11000 },
  { tipo: 'materiales', valor_total: 12870 },
  { tipo: 'materiales', valor_total: 612 },
  { tipo: 'materiales', valor_total: 14025 },
  { tipo: 'materiales', valor_total: 2133 },
  { tipo: 'materiales', valor_total: 154 },
  { tipo: 'viaticos', valor_total: 1400 },
  { tipo: 'materiales', valor_total: 2640 },
  { tipo: 'mo_propia', valor_total: 12700 },
  { tipo: 'materiales', valor_total: 1000 },
  { tipo: 'materiales', valor_total: 308.33 },
  { tipo: 'mo_propia', valor_total: 1400 },
]

const ITEMS_COT_2026_0002 = [
  {
    nombre: 'BARANDA TELESCOPICA',
    cantidad: 794,
    subtotal: 71132.33,
    es_ajuste: false,
    rubros: RUBROS_BARANDA,
  },
  {
    // El AIU. No es costo: es el cuadre del precio de venta.
    nombre: 'Administración (6%) e imprevistos (5%)',
    cantidad: 1,
    subtotal: 0,
    es_ajuste: true,
    rubros: [],
  },
]

describe('presupuesto de costo por rubro', () => {
  it('COT-2026-0002: cuadra con cotizaciones.costo_total, no con el costo unitario', () => {
    const presupuesto = calcularPresupuestoPorRubro(ITEMS_COT_2026_0002)

    // El defecto que se arregla: sin la cantidad daba 71.132,33 (794 veces menos).
    expect(totalPresupuestado(presupuesto)).toBeCloseTo(56_479_070.02, 2)
    expect(totalPresupuestado(presupuesto)).not.toBeCloseTo(71_132.33, 2)
  })

  it('COT-2026-0002: cada tipo de rubro sale multiplicado por la cantidad', () => {
    const presupuesto = calcularPresupuestoPorRubro(ITEMS_COT_2026_0002)
    const porTipo = Object.fromEntries(presupuesto.map(r => [r.tipo, r.total]))

    expect(porTipo.materiales).toBeCloseTo(44_632.33 * 794, 2)
    expect(porTipo.mo_propia).toBeCloseTo(14_100 * 794, 2)
    expect(porTipo.servicios_prof).toBeCloseTo(11_000 * 794, 2)
    expect(porTipo.viaticos).toBeCloseTo(1_400 * 794, 2)

    // Ordenado de mayor a menor: materiales manda en este caso.
    expect(presupuesto[0].tipo).toBe('materiales')
  })

  it('el ítem de ajuste no entra al presupuesto de costo', () => {
    const conAjusteCaro = [
      ...ITEMS_COT_2026_0002,
      // Un AIU con `subtotal` distinto de cero (dato viejo): tampoco cuenta.
      { nombre: 'AIU', cantidad: 1, subtotal: 6_212_698, es_ajuste: true, rubros: [] },
    ]
    expect(totalPresupuestado(calcularPresupuestoPorRubro(conAjusteCaro))).toBeCloseTo(
      56_479_070.02,
      2,
    )
  })

  it('ítem sin rubros: el subtotal es el costo unitario y también se multiplica', () => {
    const presupuesto = calcularPresupuestoPorRubro([
      { cantidad: 3, subtotal: 500_000, es_ajuste: false, rubros: [] },
    ])
    expect(presupuesto).toEqual([{ tipo: 'otro', nombre: 'otro', total: 1_500_000 }])
  })

  it('cantidad nula, cero o ausente cuenta como 1, igual que el editor', () => {
    const total = (cantidad: number | null | undefined) =>
      totalPresupuestado(
        calcularPresupuestoPorRubro([
          { cantidad, subtotal: 0, rubros: [{ tipo: 'materiales', valor_total: 800_000 }] },
        ]),
      )
    expect(total(null)).toBe(800_000)
    expect(total(undefined)).toBe(800_000)
    expect(total(0)).toBe(800_000)
  })

  it('sin ítems no hay línea base: presupuesto vacío, no cero disfrazado', () => {
    expect(calcularPresupuestoPorRubro([])).toEqual([])
    expect(totalPresupuestado([])).toBe(0)
  })
})

describe('ejecutado por rubro', () => {
  const presupuesto = calcularPresupuestoPorRubro(ITEMS_COT_2026_0002)

  it('las horas de staff cuentan contra el rubro de mano de obra propia', () => {
    const conEjecutado = asignarEjecutadoPorRubro({
      presupuesto,
      gastosPorCategoria: [],
      costoHoras: 2_400_000,
    })
    const moPropia = conEjecutado.find(r => r.tipo === 'mo_propia')!
    // Antes del arreglo este rubro mostraba 0% aunque hubiera horas cargadas.
    expect(moPropia.ejecutado).toBe(2_400_000)
  })

  it('gastos de mano de obra y horas se SUMAN, no se reemplazan', () => {
    const conEjecutado = asignarEjecutadoPorRubro({
      presupuesto,
      gastosPorCategoria: [{ categoria: 'mano_de_obra', total: 1_000_000 }],
      costoHoras: 2_400_000,
    })
    expect(conEjecutado.find(r => r.tipo === 'mo_propia')!.ejecutado).toBe(3_400_000)
  })

  it('un gasto cuenta contra UN solo rubro aunque encaje en dos', () => {
    // `servicios_profesionales` puede contar contra `servicios_prof` o `mo_terceros`.
    const conAmbos = calcularPresupuestoPorRubro([
      {
        cantidad: 1,
        subtotal: 0,
        rubros: [
          { tipo: 'servicios_prof', valor_total: 4_000_000 },
          { tipo: 'mo_terceros', valor_total: 1_000_000 },
        ],
      },
    ])
    const conEjecutado = asignarEjecutadoPorRubro({
      presupuesto: conAmbos,
      gastosPorCategoria: [{ categoria: 'servicios_profesionales', total: 3_000_000 }],
      costoHoras: 0,
    })
    const suma = conEjecutado.reduce((s, r) => s + r.ejecutado, 0)
    expect(suma).toBe(3_000_000)
    expect(conEjecutado.find(r => r.tipo === 'servicios_prof')!.ejecutado).toBe(3_000_000)
    expect(conEjecutado.find(r => r.tipo === 'mo_terceros')!.ejecutado).toBe(0)
  })

  it('cae al segundo candidato cuando el primero no está presupuestado', () => {
    const soloTerceros = calcularPresupuestoPorRubro([
      { cantidad: 1, subtotal: 0, rubros: [{ tipo: 'mo_terceros', valor_total: 5_000_000 }] },
    ])
    const conEjecutado = asignarEjecutadoPorRubro({
      presupuesto: soloTerceros,
      gastosPorCategoria: [{ categoria: 'servicios_profesionales', total: 900_000 }],
      costoHoras: 0,
    })
    expect(conEjecutado.find(r => r.tipo === 'mo_terceros')!.ejecutado).toBe(900_000)
  })

  it('la suma de los ejecutados nunca pasa del costo total del KPI', () => {
    const gastosPorCategoria = [
      { categoria: 'materiales', total: 20_000_000 },
      { categoria: 'transporte', total: 800_000 },
      { categoria: 'alimentacion', total: 300_000 },
      { categoria: 'servicios_profesionales', total: 5_000_000 },
      { categoria: 'mano_de_obra', total: 1_000_000 },
      // Sin rubro equivalente: no entra en ninguna barra (hueco conocido).
      { categoria: 'comision', total: 2_000_000 },
      { categoria: 'software', total: 400_000 },
    ]
    const costoHoras = 3_000_000
    const totalGastos = gastosPorCategoria.reduce((s, g) => s + g.total, 0)
    const costoTotal = totalGastos + costoHoras

    const conEjecutado = asignarEjecutadoPorRubro({ presupuesto, gastosPorCategoria, costoHoras })
    const sumaEjecutado = conEjecutado.reduce((s, r) => s + r.ejecutado, 0)

    expect(sumaEjecutado).toBeLessThanOrEqual(costoTotal)
    // Transporte y alimentación caen los dos en el rubro `viaticos`, sumados una vez.
    expect(conEjecutado.find(r => r.tipo === 'viaticos')!.ejecutado).toBe(1_100_000)
    // La comisión y el software no tienen rubro en este presupuesto: quedan fuera.
    expect(sumaEjecutado).toBe(costoTotal - 2_000_000 - 400_000)
  })

  it('sin rubro de mano de obra propia, las horas no se fuerzan a otro rubro', () => {
    const soloMateriales = calcularPresupuestoPorRubro([
      { cantidad: 1, subtotal: 0, rubros: [{ tipo: 'materiales', valor_total: 1_000_000 }] },
    ])
    const conEjecutado = asignarEjecutadoPorRubro({
      presupuesto: soloMateriales,
      gastosPorCategoria: [],
      costoHoras: 700_000,
    })
    expect(conEjecutado.every(r => r.ejecutado === 0)).toBe(true)
  })
})
