import { describe, it, expect } from 'vitest'
import {
  calcularPresupuestoPorRubro,
  asignarEjecutadoPorRubro,
  calcularCostoHoras,
  resolverLineaBase,
  totalPresupuestado,
  CONCEPTO_HORAS_STAFF,
} from './presupuesto-ejecucion'

/**
 * Los datos de `COT-2026-0002` son filas REALES copiadas de producción el 2026-09-04
 * (workspace 971a4e80-e923-4a29-8730-f40b88e4be4e, negocio `B1 26 1` de `wmc-sm`). Si
 * algún día dejan de cuadrar, la prueba envejeció: la cotización se editó.
 * `cotizaciones.costo_total` de esa fila era 56.479.070,02 y `valor_total`
 * 118.960.698,00.
 *
 * Verificado el mismo día contra las 6 cotizaciones aceptadas de producción: en las 6,
 * `sum(sum(rubros) x cantidad)` excluyendo `es_ajuste` es exactamente `costo_total`.
 *
 * **16 mutaciones probadas, re-corridas todas el 2026-09-05 contra este archivo (no
 * citadas de memoria del #529). Las 16 tumbaron al menos una prueba.** El conteo es el
 * medido, no el estimado — arnés en `_qa/mutar.py`, borrado antes de commitear.
 *
 * Del #529, sobre la aritmética del presupuesto:
 *  - quitar `* cantidad` en la rama de rubros → 3 rojas
 *  - quitar `* cantidad` en la rama de fallback por subtotal → 1 roja
 *  - `if (item.es_ajuste) continue` → `if (false) continue` → 1 roja
 *  - `Number(item.cantidad) || 1` → `Number(item.cantidad) ?? 1` → 1 roja
 *  - quitar el `+ costoHoras` de `mo_propia` → 3 rojas
 *  - reemplazar (en vez de sumar) los gastos de `mano_de_obra` por `costoHoras` → 2 rojas
 *  - dejar que un gasto cuente contra TODOS sus candidatos y no solo el primero → 1 roja
 *
 * Del arreglo de los tres huecos (2026-09-05):
 *  - dejar de acumular en `huerfanos` cuando no hay `destino` → 2 rojas
 *  - mandar las horas a `mo_propia` aunque el rubro no exista → 1 roja
 *  - contar como "sin tarifa" un registro de 0 horas → 1 roja
 *  - no separar `sinStaff` de `sinSalario` (sumarlos al mismo contador) → 1 roja
 *  - poner una tarifa por defecto cuando el salario es 0 → 3 rojas
 *  - elegir la cotización aceptada más VIEJA en vez de la más nueva → 2 rojas
 *  - devolver `sin_cotizacion` cuando solo hay rechazadas → 1 roja
 *  - quitar el desempate estable por `id` en `masNuevaPrimero` → 1 roja
 *  - ordenar enviadas y borradores mezclados en vez de por grupo → 1 roja
 *
 * ⚠️ **Una mutación del #529 había quedado huérfana y volvió a tener dueño.** Quitar el
 * guard `tiposPresentes.has(...)` antes de sumar las horas no tumbaba nada, porque el
 * `map` final descartaba lo que no estaba en el presupuesto; por eso allí se borró la
 * línea en vez de escribir la prueba. Ahora ese guard decide si las horas van al rubro
 * o salen por `sinPresupuesto`, o sea que SÍ cambia un resultado observable: la línea
 * volvió porque volvió a significar algo, no por simetría, y la mutación cae.
 *
 * ⚠️ La prueba "una enviada manda sobre un borrador" **se vio fallar contra la primera
 * implementación**, escrita desde la intención: ordenaba `[...enviadas, ...borradores]`
 * como una sola lista, así que un borrador nuevo tapaba una enviada vieja. El código se
 * corrigió; la prueba no se tocó.
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
    const { rubros } = asignarEjecutadoPorRubro({
      presupuesto,
      gastosPorCategoria: [],
      costoHoras: 2_400_000,
    })
    const moPropia = rubros.find(r => r.tipo === 'mo_propia')!
    // Antes del arreglo este rubro mostraba 0% aunque hubiera horas cargadas.
    expect(moPropia.ejecutado).toBe(2_400_000)
  })

  it('gastos de mano de obra y horas se SUMAN, no se reemplazan', () => {
    const { rubros } = asignarEjecutadoPorRubro({
      presupuesto,
      gastosPorCategoria: [{ categoria: 'mano_de_obra', total: 1_000_000 }],
      costoHoras: 2_400_000,
    })
    expect(rubros.find(r => r.tipo === 'mo_propia')!.ejecutado).toBe(3_400_000)
  })

  it('cada gasto cuenta contra UN rubro, no contra todos sus candidatos', () => {
    const conAmbos = calcularPresupuestoPorRubro([
      {
        cantidad: 1,
        subtotal: 0,
        rubros: [
          { tipo: 'servicios_prof', valor_total: 4_000_000 },
          { tipo: 'mo_terceros', valor_total: 3_000_000 },
        ],
      },
    ])
    const { rubros, sinPresupuesto } = asignarEjecutadoPorRubro({
      presupuesto: conAmbos,
      gastosPorCategoria: [{ categoria: 'servicios_profesionales', total: 1_200_000 }],
      costoHoras: 0,
    })
    expect(rubros.find(r => r.tipo === 'servicios_prof')!.ejecutado).toBe(1_200_000)
    expect(rubros.find(r => r.tipo === 'mo_terceros')!.ejecutado).toBe(0)
    expect(sinPresupuesto.total).toBe(0)
  })

  it('cae al segundo candidato cuando el primero no está presupuestado', () => {
    const soloTerceros = calcularPresupuestoPorRubro([
      { cantidad: 1, subtotal: 0, rubros: [{ tipo: 'mo_terceros', valor_total: 5_000_000 }] },
    ])
    const { rubros } = asignarEjecutadoPorRubro({
      presupuesto: soloTerceros,
      gastosPorCategoria: [{ categoria: 'servicios_profesionales', total: 900_000 }],
      costoHoras: 0,
    })
    expect(rubros.find(r => r.tipo === 'mo_terceros')!.ejecutado).toBe(900_000)
  })

  it('rubros + sin presupuesto reconcilian con el KPI de costo total', () => {
    const gastosPorCategoria = [
      { categoria: 'materiales', total: 20_000_000 },
      { categoria: 'transporte', total: 800_000 },
      { categoria: 'alimentacion', total: 300_000 },
      { categoria: 'servicios_profesionales', total: 5_000_000 },
      { categoria: 'mano_de_obra', total: 1_000_000 },
      // Sin rubro equivalente: no entra en ninguna barra, pero YA no desaparece.
      { categoria: 'comision', total: 2_000_000 },
      { categoria: 'software', total: 400_000 },
    ]
    const costoHoras = 3_000_000
    const totalGastos = gastosPorCategoria.reduce((s, g) => s + g.total, 0)
    const costoTotal = totalGastos + costoHoras

    const { rubros, sinPresupuesto } = asignarEjecutadoPorRubro({
      presupuesto,
      gastosPorCategoria,
      costoHoras,
    })
    const sumaEjecutado = rubros.reduce((s, r) => s + r.ejecutado, 0)

    // La invariante que sostiene la sección: nada se pierde y nada se cuenta dos veces.
    expect(sumaEjecutado + sinPresupuesto.total).toBe(costoTotal)
    // Transporte y alimentación caen los dos en el rubro `viaticos`, sumados una vez.
    expect(rubros.find(r => r.tipo === 'viaticos')!.ejecutado).toBe(1_100_000)
    // La comisión y el software no tienen rubro en este presupuesto.
    expect(sinPresupuesto.total).toBe(2_400_000)
    expect(sinPresupuesto.conceptos).toEqual([
      { concepto: 'comision', total: 2_000_000 },
      { concepto: 'software', total: 400_000 },
    ])
  })

  it('B1 26 2 (wmc-sm): el 89% del gasto quedaría fuera de las barras', () => {
    // Caso REAL de producción medido el 2026-09-05. El negocio tiene $84.354.054 de
    // gasto y una cotización en BORRADOR cuyos rubros son mo_propia / materiales /
    // servicios_prof. El día que alguien la apruebe, esto es lo que pasaría: dos barras
    // sumando $9,1M mientras el KPI de costo total dice $84,4M.
    const presupuestoBorrador = calcularPresupuestoPorRubro([
      {
        cantidad: 1,
        subtotal: 0,
        rubros: [
          { tipo: 'mo_propia', valor_total: 11_054_400 },
          { tipo: 'materiales', valor_total: 55_983_347 },
          { tipo: 'servicios_prof', valor_total: 8_624_000 },
        ],
      },
    ])
    const gastosPorCategoria = [
      { categoria: 'otros', total: 61_509_756 },
      { categoria: 'transporte', total: 7_976_378 },
      { categoria: 'materiales', total: 4_620_000 },
      { categoria: 'servicios_profesionales', total: 4_475_000 },
      { categoria: 'marketing', total: 3_572_920 },
      { categoria: 'arriendo', total: 2_200_000 },
    ]

    const { rubros, sinPresupuesto } = asignarEjecutadoPorRubro({
      presupuesto: presupuestoBorrador,
      gastosPorCategoria,
      costoHoras: 0,
    })

    expect(rubros.reduce((s, r) => s + r.ejecutado, 0)).toBe(9_095_000)
    expect(sinPresupuesto.total).toBe(75_259_054)
    // Ordenado de mayor a menor: `otros` es lo primero que hay que ir a mirar.
    expect(sinPresupuesto.conceptos[0]).toEqual({ concepto: 'otros', total: 61_509_756 })
    expect(sinPresupuesto.conceptos.map(c => c.concepto)).toEqual([
      'otros',
      'transporte',
      'marketing',
      'arriendo',
    ])
    // Y sigue reconciliando.
    expect(rubros.reduce((s, r) => s + r.ejecutado, 0) + sinPresupuesto.total).toBe(84_354_054)
  })

  it('sin rubro de mano de obra propia, las horas salen por sin presupuesto', () => {
    const soloMateriales = calcularPresupuestoPorRubro([
      { cantidad: 1, subtotal: 0, rubros: [{ tipo: 'materiales', valor_total: 1_000_000 }] },
    ])
    const { rubros, sinPresupuesto } = asignarEjecutadoPorRubro({
      presupuesto: soloMateriales,
      gastosPorCategoria: [],
      costoHoras: 700_000,
    })
    // No se fuerzan a otro rubro...
    expect(rubros.every(r => r.ejecutado === 0)).toBe(true)
    // ...pero tampoco se pierden.
    expect(sinPresupuesto.conceptos).toEqual([
      { concepto: CONCEPTO_HORAS_STAFF, total: 700_000 },
    ])
  })

  it('un gasto en 0 no llena la lista de sin presupuesto con ruido', () => {
    const { sinPresupuesto } = asignarEjecutadoPorRubro({
      presupuesto,
      gastosPorCategoria: [{ categoria: 'comision', total: 0 }],
      costoHoras: 0,
    })
    expect(sinPresupuesto.total).toBe(0)
    expect(sinPresupuesto.conceptos).toEqual([])
  })
})

describe('costo de las horas y las que no se pudieron valorar', () => {
  it('la tarifa es el salario mensual sobre 160 horas', () => {
    const { costo, totalHoras, sinTarifa } = calcularCostoHoras({
      horas: [{ horas: 8, staff_id: 'a' }, { horas: 2, staff_id: 'a' }],
      salarioPorStaff: { a: 3_200_000 },
    })
    expect(costo).toBe(200_000)
    expect(totalHoras).toBe(10)
    expect(sinTarifa.filas).toBe(0)
  })

  it('sin responsable, la hora vale cero y el hueco queda declarado', () => {
    // Caso REAL: `E1 26 2` de dimpro, 0,08 h con `staff_id` nulo (medido 2026-09-05).
    const { costo, sinTarifa } = calcularCostoHoras({
      horas: [{ horas: 0.08, staff_id: null }],
      salarioPorStaff: {},
    })
    expect(costo).toBe(0)
    expect(sinTarifa).toEqual({ filas: 1, horas: 0.08, sinStaff: 1, sinSalario: 0 })
  })

  it('responsable sin salario configurado se cuenta aparte de responsable ausente', () => {
    // Las dos causas se arreglan en pantallas distintas, así que se cuentan distinto.
    const { costo, sinTarifa } = calcularCostoHoras({
      horas: [
        { horas: 5, staff_id: 'sin-salario' },
        { horas: 3, staff_id: null },
        { horas: 4, staff_id: 'con-salario' },
      ],
      salarioPorStaff: { 'sin-salario': 0, 'con-salario': 1_600_000 },
    })
    expect(costo).toBe(40_000)
    expect(sinTarifa).toEqual({ filas: 2, horas: 8, sinStaff: 1, sinSalario: 1 })
  })

  it('NO se inventa una tarifa por defecto cuando falta el salario', () => {
    const { costo } = calcularCostoHoras({
      horas: [{ horas: 100, staff_id: 'x' }],
      salarioPorStaff: { x: 0 },
    })
    expect(costo).toBe(0)
  })

  it('un registro de 0 horas sin responsable no dispara el aviso', () => {
    const { sinTarifa } = calcularCostoHoras({
      horas: [{ horas: 0, staff_id: null }],
      salarioPorStaff: {},
    })
    expect(sinTarifa.filas).toBe(0)
  })

  it('sin horas registradas no hay nada que advertir', () => {
    const { costo, totalHoras, sinTarifa } = calcularCostoHoras({ horas: [], salarioPorStaff: {} })
    expect(costo).toBe(0)
    expect(totalHoras).toBe(0)
    expect(sinTarifa.filas).toBe(0)
  })
})

describe('línea base del presupuesto', () => {
  it('E1 26 2 (dimpro): con DOS aceptadas manda la más reciente y se declara', () => {
    // Caso REAL medido en producción el 2026-09-05: ese negocio tiene las dos.
    const lineaBase = resolverLineaBase([
      { id: 'vieja', consecutivo: 'COT-2026-0001', estado: 'aceptada', created_at: '2026-04-13T21:02:16.525057+00:00' },
      { id: 'nueva', consecutivo: 'COT-2026-0002', estado: 'aceptada', created_at: '2026-04-13T21:19:27.768460+00:00' },
    ])
    expect(lineaBase.estado).toBe('aprobada')
    if (lineaBase.estado !== 'aprobada') throw new Error('estado inesperado')
    expect(lineaBase.cotizacion.consecutivo).toBe('COT-2026-0002')
    expect(lineaBase.otrasAprobadas).toBe(1)
  })

  it('la elección no depende del orden en que lleguen las filas', () => {
    // Antes la elegía un `.find()` sobre el arreglo, y el orden lo fijaba el `.order()`
    // de una consulta a mil líneas de distancia: cambiarlo movía el presupuesto.
    const filas = [
      { id: 'a', consecutivo: 'A', estado: 'aceptada', created_at: '2026-01-01T00:00:00Z' },
      { id: 'b', consecutivo: 'B', estado: 'aceptada', created_at: '2026-05-01T00:00:00Z' },
    ]
    const enUnOrden = resolverLineaBase(filas)
    const enElOtro = resolverLineaBase([...filas].reverse())
    expect(enUnOrden).toEqual(enElOtro)
    if (enUnOrden.estado !== 'aprobada') throw new Error('estado inesperado')
    expect(enUnOrden.cotizacion.consecutivo).toBe('B')
  })

  it('con la misma fecha el desempate es estable, no aleatorio', () => {
    const misma = '2026-05-01T00:00:00Z'
    const filas = [
      { id: 'aaa', consecutivo: 'A', estado: 'aceptada', created_at: misma },
      { id: 'zzz', consecutivo: 'Z', estado: 'aceptada', created_at: misma },
    ]
    const primera = resolverLineaBase(filas)
    const segunda = resolverLineaBase([...filas].reverse())
    expect(primera).toEqual(segunda)
  })

  it('sin ninguna cotización lo dice, en vez de dejar la sección en blanco', () => {
    expect(resolverLineaBase([])).toEqual({ estado: 'sin_cotizacion' })
  })

  it('borrador: no es línea base, y se nombra para poder ir a buscarla', () => {
    // Es el estado en que queda un negocio tras `corregirCotizacionAceptada`.
    const lineaBase = resolverLineaBase([
      { id: 'x', consecutivo: 'COT-2026-0003', estado: 'borrador', created_at: '2026-06-01T00:00:00Z' },
      { id: 'y', consecutivo: 'COT-2026-0002', estado: 'rechazada', created_at: '2026-05-01T00:00:00Z' },
    ])
    expect(lineaBase).toEqual({
      estado: 'sin_aprobar',
      borradores: 1,
      enviadas: 0,
      rechazadas: 1,
      pendiente: 'COT-2026-0003',
    })
  })

  it('una enviada manda sobre un borrador: es la que está más cerca de aprobarse', () => {
    const lineaBase = resolverLineaBase([
      { id: 'x', consecutivo: 'BORRADOR', estado: 'borrador', created_at: '2026-07-01T00:00:00Z' },
      { id: 'y', consecutivo: 'ENVIADA', estado: 'enviada', created_at: '2026-06-01T00:00:00Z' },
    ])
    if (lineaBase.estado !== 'sin_aprobar') throw new Error('estado inesperado')
    expect(lineaBase.pendiente).toBe('ENVIADA')
  })

  it('solo rechazadas NO es lo mismo que no tener cotización', () => {
    const lineaBase = resolverLineaBase([
      { id: 'x', consecutivo: 'COT-1', estado: 'rechazada', created_at: '2026-05-01T00:00:00Z' },
    ])
    expect(lineaBase).toEqual({
      estado: 'sin_aprobar',
      borradores: 0,
      enviadas: 0,
      rechazadas: 1,
      pendiente: null,
    })
  })
})
