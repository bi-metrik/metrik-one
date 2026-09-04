/**
 * Presupuesto vs Ejecutado del bloque de Ejecución.
 *
 * Operaciones puras que antes vivían embebidas en `getNegocioDetalle` y en la pantalla,
 * cada una con su propio criterio:
 *
 *  1. `calcularPresupuestoPorRubro` — cuánto costo se cotizó, por tipo de rubro.
 *  2. `asignarEjecutadoPorRubro` — contra qué rubro cuenta cada peso ya ejecutado, y
 *     cuánto no cuenta contra ninguno.
 *  3. `calcularCostoHoras` — cuánto valen las horas y cuántas no se pudieron valorar.
 *  4. `resolverLineaBase` — cuál cotización fija el presupuesto, o por qué no hay.
 *
 * El presupuesto de COSTO no es el precio de venta. `cotizaciones.valor_total` es lo
 * que paga el cliente; `cotizaciones.costo_total` es lo que la empresa se comprometió
 * a gastar. Comparar el gasto contra el primero mide margen consumido, no sobrecosto:
 * un caso puede gastar el doble de su presupuesto y seguir bajo el precio.
 */

/** Ítem de cotización tal como lo trae la lectura del detalle de negocio. */
export interface ItemPresupuesto {
  cantidad?: number | null
  subtotal?: number | null
  es_ajuste?: boolean | null
  rubros?: Array<{ tipo?: string | null; valor_total?: number | null }> | null
}

export interface RubroPresupuesto {
  tipo: string
  nombre: string
  total: number
}

export interface RubroPresupuestoEjecutado extends RubroPresupuesto {
  ejecutado: number
}

/**
 * Pseudo-tipo para el ítem que se cotizó sin desglose de rubros. No está en
 * `TIPOS_RUBRO` (`src/lib/catalogos/constants.ts`): existe solo para que ese costo
 * tenga dónde caer en la comparación en vez de desaparecer.
 */
export const TIPO_RUBRO_SIN_DETALLE = 'otro'

/**
 * Categoría de gasto → tipos de rubro contra los que puede contar, en orden de
 * preferencia. Es el inverso de `CAT_TO_RUBRO_TIPOS` del formulario de gasto nuevo
 * (`src/app/(app)/nuevo/gasto/nuevo-gasto-form.tsx`), que es quien decide a qué rubro
 * se auto-asigna un gasto al crearlo. Mantener los dos de acuerdo.
 *
 * El orden importa: cada gasto cuenta contra UN solo rubro (el primero de su lista
 * que exista en el presupuesto), porque si contara contra dos la suma de los rubros
 * pasaría del costo total ejecutado y las barras mentirían hacia arriba.
 *
 * Las categorías que no aparecen aquí (`comision`, `arriendo`, `marketing`,
 * `capacitacion`) no tienen rubro equivalente. Su gasto ya no desaparece: sale por
 * `sinPresupuesto`, que es plata gastada fuera de lo cotizado y merece verse.
 */
export const CATEGORIA_GASTO_A_TIPOS_RUBRO: Record<string, string[]> = {
  materiales: ['materiales'],
  transporte: ['viaticos'],
  alimentacion: ['viaticos'],
  viaticos: ['viaticos'],
  software: ['software'],
  servicios_profesionales: ['servicios_prof', 'mo_terceros'],
  mano_de_obra: ['mo_propia', 'mo_terceros'],
  otros: [TIPO_RUBRO_SIN_DETALLE],
}

/** Rubro contra el que cuentan las horas de staff registradas en el negocio. */
export const TIPO_RUBRO_HORAS_STAFF = 'mo_propia'

/**
 * Concepto con el que las horas de staff aparecen en `sinPresupuesto`. No es una
 * categoría de gasto: es el otro sumando del costo ejecutado.
 */
export const CONCEPTO_HORAS_STAFF = '__horas_staff__'

/** Horas de un mes con las que se deriva la tarifa a partir del salario mensual. */
export const HORAS_MES_TARIFA = 160

/**
 * Presupuesto de costo por tipo de rubro.
 *
 * Réplica exacta de `totalCosto` en `recalcularTotales` (`cotizacion-actions.ts`), que
 * es quien llena `cotizaciones.costo_total`:
 *
 *     costo del ítem = (suma de sus rubros) x cantidad
 *
 * Las dos piezas que faltaban aquí y hacían que el presupuesto saliera hasta 794 veces
 * más chico que el real:
 *
 * - **La cantidad.** Un ítem de 794 unidades a 71.132,33 de costo unitario presupuesta
 *   56.479.070,02, no 71.132,33.
 * - **El ítem de ajuste** (`es_ajuste`) queda fuera. No es costo: es el cuadre del
 *   precio de venta (AIU o descuento comercial). Su `subtotal` es 0 y su valor vive en
 *   `precio_venta`, así que sumarlo metería precio dentro del presupuesto de costo.
 *
 * `Number(cantidad) || 1` es literal del editor: cantidad nula, 0 o no numérica cuenta
 * como 1. Cambiarlo aquí descuadraría contra `costo_total`.
 */
export function calcularPresupuestoPorRubro(items: ItemPresupuesto[]): RubroPresupuesto[] {
  const porTipo: Record<string, number> = {}

  for (const item of items) {
    if (item.es_ajuste) continue

    const cantidad = Number(item.cantidad) || 1
    const rubros = item.rubros ?? []

    if (rubros.length > 0) {
      for (const rubro of rubros) {
        const tipo = rubro.tipo ?? TIPO_RUBRO_SIN_DETALLE
        porTipo[tipo] = (porTipo[tipo] ?? 0) + (Number(rubro.valor_total) || 0) * cantidad
      }
    } else {
      // Ítem sin desglose: su `subtotal` es el costo unitario.
      porTipo[TIPO_RUBRO_SIN_DETALLE] =
        (porTipo[TIPO_RUBRO_SIN_DETALLE] ?? 0) + (Number(item.subtotal) || 0) * cantidad
    }
  }

  return Object.entries(porTipo)
    .map(([tipo, total]) => ({ tipo, nombre: tipo, total }))
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total)
}

/** Un sumando del ejecutado que no cuenta contra ningún rubro del presupuesto. */
export interface ConceptoSinPresupuesto {
  /** Categoría de gasto, o `CONCEPTO_HORAS_STAFF` para las horas de staff. */
  concepto: string
  total: number
}

export interface RepartoEjecutado {
  rubros: RubroPresupuestoEjecutado[]
  /**
   * Lo ejecutado que NO cae en ningún rubro. Antes desaparecía de la sección y solo
   * salía abajo, en la lista suelta de gastos por categoría, sin relación visible con
   * el presupuesto. Es plata gastada fuera de lo cotizado: se muestra, y se muestra
   * SIN barra, porque no tiene contra qué compararse.
   */
  sinPresupuesto: {
    total: number
    conceptos: ConceptoSinPresupuesto[]
  }
}

/**
 * Reparte lo ya ejecutado (gastos por categoría + costo de las horas de staff) entre
 * los rubros del presupuesto, y devuelve aparte lo que no cupo en ninguno.
 *
 * **Invariante que sostiene la pantalla:**
 *
 *     suma(rubros.ejecutado) + sinPresupuesto.total === suma(gastos) + costoHoras
 *
 * o sea el KPI "Costo total". Cada peso cae en exactamente un lado, nunca en dos y
 * nunca en ninguno. Es lo que permite que la sección reconcilie de arriba abajo: las
 * barras más la fila sin presupuesto dan el total de la barra de abajo.
 *
 * Las horas cuentan contra `mo_propia` y se SUMAN a los gastos de categoría
 * `mano_de_obra` que ya hubiera; no lo reemplazan. Son dos formas distintas de
 * registrar mano de obra (el reloj y la factura) y el rubro presupuestó las dos.
 * Si el presupuesto no tiene rubro `mo_propia`, las horas no se fuerzan a otro rubro:
 * salen por `sinPresupuesto`, que es donde se ven en vez de perderse.
 */
export function asignarEjecutadoPorRubro(params: {
  presupuesto: RubroPresupuesto[]
  gastosPorCategoria: Array<{ categoria: string; total: number }>
  costoHoras: number
}): RepartoEjecutado {
  const { presupuesto, gastosPorCategoria, costoHoras } = params
  const tiposPresentes = new Set(presupuesto.map(r => r.tipo))
  const ejecutado: Record<string, number> = {}
  const huerfanos: ConceptoSinPresupuesto[] = []

  for (const gasto of gastosPorCategoria) {
    const monto = Number(gasto.total) || 0
    // Sin entrada en el mapa, se intenta contra un rubro del mismo nombre: cubre las
    // categorías cuyo valor coincide con el tipo de rubro sin necesidad de listarlas.
    const candidatos = CATEGORIA_GASTO_A_TIPOS_RUBRO[gasto.categoria] ?? [gasto.categoria]
    const destino = candidatos.find(t => tiposPresentes.has(t))
    if (destino) {
      ejecutado[destino] = (ejecutado[destino] ?? 0) + monto
    } else if (monto !== 0) {
      huerfanos.push({ concepto: gasto.categoria, total: monto })
    }
  }

  // El guard volvió a existir y ahora SÍ cambia un resultado observable: decide si las
  // horas cuentan contra el rubro o si se declaran fuera del presupuesto. Quitarlo
  // vuelve a perderlas (ver la mutación anotada en el archivo de pruebas).
  if (costoHoras > 0) {
    if (tiposPresentes.has(TIPO_RUBRO_HORAS_STAFF)) {
      ejecutado[TIPO_RUBRO_HORAS_STAFF] = (ejecutado[TIPO_RUBRO_HORAS_STAFF] ?? 0) + costoHoras
    } else {
      huerfanos.push({ concepto: CONCEPTO_HORAS_STAFF, total: costoHoras })
    }
  }

  return {
    rubros: presupuesto.map(r => ({ ...r, ejecutado: ejecutado[r.tipo] ?? 0 })),
    sinPresupuesto: {
      total: huerfanos.reduce((s, h) => s + h.total, 0),
      conceptos: huerfanos.sort((a, b) => b.total - a.total),
    },
  }
}

/** Presupuesto total de costo: lo que debe cuadrar con `cotizaciones.costo_total`. */
export function totalPresupuestado(presupuesto: RubroPresupuesto[]): number {
  return presupuesto.reduce((suma, r) => suma + r.total, 0)
}

// ── Costo de las horas, y el hueco que deja ──────────────────────────────────

export interface HoraRegistrada {
  horas?: number | null
  staff_id?: string | null
}

/**
 * Las horas que entraron al costo valiendo CERO. No es un error del registro: es que
 * el sistema no tiene con qué valorarlas, y sin decirlo el costo ejecutado sale más
 * bajo de lo real y el semáforo se lee en verde por omisión.
 */
export interface HorasSinTarifa {
  /** Registros de hora que no se pudieron valorar. */
  filas: number
  /** Horas de esos registros. */
  horas: number
  /** De esos, los que no tienen responsable asignado. */
  sinStaff: number
  /** De esos, los que tienen responsable pero sin salario configurado. */
  sinSalario: number
}

export interface CostoHoras {
  /** Costo en pesos de las horas que SÍ se pudieron valorar. */
  costo: number
  totalHoras: number
  sinTarifa: HorasSinTarifa
}

/**
 * Costo de las horas de staff y, en la misma pasada, cuántas no se pudieron valorar.
 *
 * La tarifa es `salary / HORAS_MES_TARIFA` **sin default inventado**: un salario
 * ausente o en cero da tarifa cero, no una cifra promedio. Poner una tarifa por
 * defecto aquí metería plata que nadie acordó dentro del costo de un negocio, que es
 * peor que la subestimación — la subestimación al menos se puede declarar, y eso es
 * justo lo que hace `sinTarifa`.
 *
 * Las dos causas se cuentan por separado a propósito: quien mira el aviso necesita
 * saber si le falta asignar el responsable de la hora o configurarle el salario, que
 * se arreglan en pantallas distintas.
 *
 * Un registro de 0 horas no cuenta como "sin tarifa" aunque no tenga responsable: no
 * hay nada que valorar, así que avisar sobre él sería ruido.
 */
export function calcularCostoHoras(params: {
  horas: HoraRegistrada[]
  salarioPorStaff: Record<string, number>
}): CostoHoras {
  const { horas, salarioPorStaff } = params
  let costo = 0
  let totalHoras = 0
  const sinTarifa: HorasSinTarifa = { filas: 0, horas: 0, sinStaff: 0, sinSalario: 0 }

  for (const registro of horas) {
    const cantidad = Number(registro.horas) || 0
    totalHoras += cantidad

    const salario = registro.staff_id ? Number(salarioPorStaff[registro.staff_id]) || 0 : 0
    if (salario > 0) {
      costo += cantidad * (salario / HORAS_MES_TARIFA)
      continue
    }

    if (cantidad <= 0) continue

    sinTarifa.filas += 1
    sinTarifa.horas += cantidad
    if (registro.staff_id) sinTarifa.sinSalario += 1
    else sinTarifa.sinStaff += 1
  }

  return {
    costo: Math.round(costo),
    totalHoras: Math.round(totalHoras * 100) / 100,
    sinTarifa: { ...sinTarifa, horas: Math.round(sinTarifa.horas * 100) / 100 },
  }
}

// ── La línea base: cuál cotización manda, o por qué no hay ────────────────────

export interface CotizacionLineaBase {
  id: string
  consecutivo?: string | null
  estado?: string | null
  created_at?: string | null
}

/**
 * Estado de la línea base contra la que se compara el ejecutado.
 *
 * `sin_aprobar` NO trae el valor de las cotizaciones que hay. Es deliberado: un número
 * al lado de un presupuesto ausente se lee como presupuesto, y una cotización en
 * borrador no es un acuerdo. Se nombra el consecutivo para poder ir a buscarla, nada
 * más.
 */
export type LineaBase<T extends CotizacionLineaBase = CotizacionLineaBase> =
  | {
      estado: 'aprobada'
      cotizacion: T
      /** Cuántas OTRAS cotizaciones aceptadas conviven con la elegida. Debería ser 0. */
      otrasAprobadas: number
    }
  | { estado: 'sin_cotizacion' }
  | {
      estado: 'sin_aprobar'
      borradores: number
      enviadas: number
      rechazadas: number
      /** Consecutivo de la más reciente que todavía se puede aprobar, si la hay. */
      pendiente?: string | null
    }

/**
 * Ordena de más nueva a más vieja con desempate ESTABLE por `id`.
 *
 * Sin el desempate, dos cotizaciones con el mismo `created_at` pueden intercambiarse
 * entre dos lecturas y el presupuesto del negocio cambiaría solo, sin que nadie tocara
 * nada. Con desempate, el resultado es el mismo siempre.
 */
function masNuevaPrimero(a: CotizacionLineaBase, b: CotizacionLineaBase): number {
  const fa = a.created_at ?? ''
  const fb = b.created_at ?? ''
  if (fa !== fb) return fb.localeCompare(fa)
  return b.id.localeCompare(a.id)
}

/**
 * Cuál cotización fija el presupuesto, o por qué el negocio no tiene línea base.
 *
 * **Por qué la elección es explícita y no un `.find()`.** Antes se tomaba la primera
 * `aceptada` del arreglo, y el orden lo fijaba el `.order('created_at', desc)` de la
 * consulta, a mil líneas de distancia: cambiar ese orden por cualquier otra razón
 * habría cambiado en silencio el presupuesto de un negocio. Y no es hipotético —
 * medido en producción el 2026-09-05, el negocio `E1 26 2` de `dimpro` tiene **DOS**
 * cotizaciones aceptadas a la vez (COT-2026-0001 y COT-2026-0002). Aquí manda la más
 * reciente, dicho en un solo lugar, y `otrasAprobadas` deja el hecho a la vista para
 * que alguien pueda arreglar el dato en vez de convivir con él sin saberlo.
 */
export function resolverLineaBase<T extends CotizacionLineaBase>(cotizaciones: T[]): LineaBase<T> {
  if (cotizaciones.length === 0) return { estado: 'sin_cotizacion' }

  const aprobadas = cotizaciones.filter(c => c.estado === 'aceptada').sort(masNuevaPrimero)
  if (aprobadas.length > 0) {
    return { estado: 'aprobada', cotizacion: aprobadas[0], otrasAprobadas: aprobadas.length - 1 }
  }

  const borradores = cotizaciones.filter(c => c.estado === 'borrador')
  const enviadas = cotizaciones.filter(c => c.estado === 'enviada')
  const rechazadas = cotizaciones.filter(c => c.estado === 'rechazada')

  // La que está más cerca de poder aprobarse: una enviada espera respuesta del cliente,
  // una en borrador espera trabajo nuestro. Una rechazada no lleva a ninguna parte.
  // El estado manda sobre la fecha: se ordena DENTRO de cada grupo, no sobre la mezcla
  // — mezclarlos deja que un borrador nuevo tape una enviada vieja, que es la que de
  // verdad está esperando una respuesta.
  const pendiente =
    [...enviadas].sort(masNuevaPrimero)[0] ?? [...borradores].sort(masNuevaPrimero)[0]

  return {
    estado: 'sin_aprobar',
    borradores: borradores.length,
    enviadas: enviadas.length,
    rechazadas: rechazadas.length,
    pendiente: pendiente?.consecutivo ?? null,
  }
}
