/**
 * El IVA del PROVEEDOR sobre el costo de una línea (Mauricio, 2026-10-19). PURO.
 *
 * Regla: los precios de los proveedores se guardan SIN IVA. La cotización tiene una casilla
 * «Calcular con IVA» que, encendida, le suma a cada línea cuyo proveedor declara IVA el 19 % a su
 * costo, y todo se recalcula (margen, precio, total, PDF) porque el costo con IVA es el que entra
 * a la cascada.
 *
 * Dónde vive cada cosa:
 *   · el costo SIN IVA: `rubros.valor_total` y `items.subtotal`, como siempre;
 *   · la decisión por línea: `items.iva_costo_pct` (19 o NULL). La escribe la casilla
 *     (`cambiarIvaDeCostos`), que sabe qué proveedor tiene cada línea;
 *   · la suma: AQUÍ, en `costosDelItem`, que usan TODOS los que arman la cascada (el editor, el
 *     recálculo del servidor, la forma por pasos y el contexto del PDF). Si cada uno sumara por su
 *     cuenta, la pantalla y el documento dirían dos totales distintos.
 *
 * El reparto por pasajero (`pasajerosParaCuadre`) y la vigencia de una confirmación se miden
 * contra el costo SIN IVA (`costoSinIva`): es el que se confirmó. El reparto es proporcional, así
 * que el IVA no le cambia los pesos.
 *
 * Una línea sin `iva_costo_pct` (todo lo de antes, todo lo que no es Trappvel) da exactamente lo
 * mismo que antes.
 */
import { costoDeRubrosConfirmados, type RubroConEstado } from './rubros-sugeridos'

/** El IVA general en Colombia, el que cobra un hotel a un residente. */
export const IVA_COSTO_PCT = 19

/** El porcentaje de IVA de la línea, saneado: 0 si no tiene o si no es un número razonable. */
export function pctDeIva(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n <= 30 ? n : 0
}

/** Un costo con su IVA encima (al centavo, como guarda la base). */
export function conIva(costo: number, pct: unknown): number {
  const p = pctDeIva(pct)
  const c = Number(costo) || 0
  if (p === 0) return c
  return Math.round(c * (1 + p / 100) * 100) / 100
}

export interface FilaConCosto {
  rubros?: Array<RubroConEstado & { valor_total?: number | null }> | null
  subtotal?: number | string | null
  iva_costo_pct?: number | string | null
}

/**
 * Lo que la cascada necesita del costo de una línea, ya con su IVA: cuántos rubros cuentan, cuánto
 * suman y el `subtotal` (costo a mano de la línea sin desglose). `costoSinIva` = la suma de los
 * rubros como se guardó, para el cuadre por pasajero.
 */
export function costosDelItem(fila: FilaConCosto): { numeroDeRubros: number; costoDeRubros: number; subtotal: number | null; costoSinIva: number; ivaPct: number } {
  const { numeroDeRubros, costoDeRubros } = costoDeRubrosConfirmados(fila.rubros)
  const ivaPct = pctDeIva(fila.iva_costo_pct)
  const subtotal = fila.subtotal === null || fila.subtotal === undefined ? null : Number(fila.subtotal)
  return {
    numeroDeRubros,
    costoDeRubros: conIva(costoDeRubros, ivaPct),
    subtotal: subtotal === null ? null : conIva(subtotal, ivaPct),
    costoSinIva: costoDeRubros,
    ivaPct,
  }
}

/**
 * El costo unitario SIN IVA de la línea, el que el recálculo vuelve a guardar en `items.subtotal`.
 * La cascada trae el costo con IVA; guardarlo así haría que la próxima lectura le sumara el IVA
 * otra vez. Se toma de lo guardado (rubros o `subtotal`), no dividiendo, para no correr centavos.
 */
export function costoUnitarioSinIva(fila: FilaConCosto): number {
  const { numeroDeRubros, costoDeRubros } = costoDeRubrosConfirmados(fila.rubros)
  if (numeroDeRubros > 0) return costoDeRubros
  return Number(fila.subtotal) || 0
}

/**
 * ¿La casilla nace encendida? Cuando nadie la ha tocado (`costos_con_iva` NULL): sí, si algún
 * proveedor de la cotización declara IVA y el viajero es residente (NULL = se asume residente).
 */
export function casillaIvaPorDefecto(e: { algunProveedorDeclaraIva: boolean; viajeroResidente: boolean | null | undefined }): boolean {
  return e.algunProveedorDeclaraIva && e.viajeroResidente !== false
}

/** El estado de la casilla: lo guardado o, si nadie la tocó, el valor por defecto. */
export function casillaIva(e: { guardada: boolean | null | undefined; algunProveedorDeclaraIva: boolean; viajeroResidente: boolean | null | undefined }): { encendida: boolean; porDefecto: boolean } {
  if (e.guardada === true || e.guardada === false) return { encendida: e.guardada, porDefecto: false }
  return { encendida: casillaIvaPorDefecto(e), porDefecto: true }
}

/** El IVA que lleva una línea: el 19 % si la casilla está encendida y su proveedor declara IVA. */
export function ivaDeLinea(casillaEncendida: boolean, proveedorDeclaraIva: boolean | null | undefined): number | null {
  return casillaEncendida && proveedorDeclaraIva === true ? IVA_COSTO_PCT : null
}
