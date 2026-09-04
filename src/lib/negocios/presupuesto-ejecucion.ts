/**
 * Presupuesto vs Ejecutado del bloque de Ejecución.
 *
 * Dos operaciones puras que antes vivían embebidas en `getNegocioDetalle` y en la
 * pantalla, cada una con su propio criterio:
 *
 *  1. `presupuestoPorRubro` — cuánto costo se cotizó, por tipo de rubro.
 *  2. `asignarEjecutadoPorRubro` — contra qué rubro cuenta cada peso ya ejecutado.
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
 * `capacitacion`) no tienen rubro equivalente: su gasto no entra en ninguna barra.
 * Es el hueco conocido, y se deja explícito en vez de repartirlo a ojo.
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

/**
 * Reparte lo ya ejecutado (gastos por categoría + costo de las horas de staff) entre
 * los rubros del presupuesto.
 *
 * Invariante que sostiene la pantalla: **la suma de `ejecutado` nunca pasa de
 * `totalGastos + costoHoras`**, el mismo número del KPI "Costo total". Cada gasto cae
 * en un rubro o en ninguno, jamás en dos.
 *
 * Las horas cuentan contra `mo_propia` y se SUMAN a los gastos de categoría
 * `mano_de_obra` que ya hubiera; no lo reemplazan. Son dos formas distintas de
 * registrar mano de obra (el reloj y la factura) y el rubro presupuestó las dos.
 * Si el presupuesto no tiene rubro `mo_propia`, las horas no se fuerzan a otro rubro:
 * siguen contando en el total, que es donde no se pierden.
 */
export function asignarEjecutadoPorRubro(params: {
  presupuesto: RubroPresupuesto[]
  gastosPorCategoria: Array<{ categoria: string; total: number }>
  costoHoras: number
}): RubroPresupuestoEjecutado[] {
  const { presupuesto, gastosPorCategoria, costoHoras } = params
  const tiposPresentes = new Set(presupuesto.map(r => r.tipo))
  const ejecutado: Record<string, number> = {}

  for (const gasto of gastosPorCategoria) {
    // Sin entrada en el mapa, se intenta contra un rubro del mismo nombre: cubre las
    // categorías cuyo valor coincide con el tipo de rubro sin necesidad de listarlas.
    const candidatos = CATEGORIA_GASTO_A_TIPOS_RUBRO[gasto.categoria] ?? [gasto.categoria]
    const destino = candidatos.find(t => tiposPresentes.has(t))
    if (!destino) continue
    ejecutado[destino] = (ejecutado[destino] ?? 0) + (Number(gasto.total) || 0)
  }

  // Sin `tiposPresentes.has(...)` a proposito: si el presupuesto no tiene rubro
  // `mo_propia`, el `map` de abajo (que recorre el presupuesto, no lo ejecutado) ya
  // deja esa entrada fuera. Un guard aqui no cambiaria ningun resultado observable.
  if (costoHoras > 0) {
    ejecutado[TIPO_RUBRO_HORAS_STAFF] = (ejecutado[TIPO_RUBRO_HORAS_STAFF] ?? 0) + costoHoras
  }

  return presupuesto.map(r => ({ ...r, ejecutado: ejecutado[r.tipo] ?? 0 }))
}

/** Presupuesto total de costo: lo que debe cuadrar con `cotizaciones.costo_total`. */
export function totalPresupuestado(presupuesto: RubroPresupuesto[]): number {
  return presupuesto.reduce((suma, r) => suma + r.total, 0)
}
