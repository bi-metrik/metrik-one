/**
 * ¿Este proveedor tiene tarifas que se puedan citar en una cotización? (Mauricio, 2026-10-21:
 * «solo se cita lo revisado»). PURO. Es EL criterio del buscador de la cotización y del filtro
 * «Con tarifas / Sin tarifas» de Proveedores: los dos llaman a esta función.
 *
 *   · Con tarifas = el proveedor tiene una extracción `revisada`. Cuenta la ÚLTIMA revisada (la misma
 *     que usa `extraccion-para-cotizar.ts` para ofrecer precios).
 *   · Para un viaje, además, su vigencia tiene que cubrir las fechas del viaje; si no las cubre, el
 *     proveedor sale en gris con «pide el tarifario nuevo» (no desaparece, no es un callejón).
 *   · Haber subido el archivo NO cuenta: el semáforo `sin_tarifario` mide archivo, no tarifas. Un
 *     borrador (extracción sin revisar) tampoco: solo pone la etiqueta «por revisar».
 */

export interface ExtraccionParaCitar {
  proveedor_id: string
  estado: string
  created_at: string
  vigencia_desde: string | null
  vigencia_hasta: string | null
}

export interface TarifasCitables {
  /** Tiene una extracción revisada: se puede citar. */
  citable: boolean
  /** La vigencia de la revisada que cuenta (la última). */
  vigencia: { desde: string | null; hasta: string | null } | null
  /**
   * La vigencia cubre las fechas pedidas. `null` = no se pidieron fechas (o la revisada no trae
   * vigencia completa): no se puede decir que no las cubre.
   */
  cubre: boolean | null
  /** Hay un borrador más nuevo que la revisada (o, sin revisada, algún borrador). */
  porRevisar: boolean
}

export const SIN_TARIFAS: TarifasCitables = { citable: false, vigencia: null, cubre: null, porRevisar: false }

const FECHA = /^\d{4}-\d{2}-\d{2}/
const fecha = (v: string | null | undefined): string | null => (v && FECHA.test(v) ? v.slice(0, 10) : null)

/**
 * ¿La vigencia cubre las fechas? `inicio` sin `fin` = un solo día (una actividad). `null` cuando no
 * hay con qué medir: sin fechas pedidas o sin vigencia completa.
 */
export function cubreFechas(vigencia: { desde: string | null; hasta: string | null } | null, fechas: { inicio: string | null; fin: string | null } | null | undefined): boolean | null {
  const desde = fecha(vigencia?.desde)
  const hasta = fecha(vigencia?.hasta)
  const inicio = fecha(fechas?.inicio)
  if (!desde || !hasta || !inicio) return null
  const fin = fecha(fechas?.fin) ?? inicio
  return inicio >= desde && fin <= hasta
}

/** Las tarifas citables de UN proveedor, de sus extracciones (de cualquier estado; las descartadas no cuentan). */
export function tarifasCitables(extracciones: readonly ExtraccionParaCitar[], fechas?: { inicio: string | null; fin: string | null } | null): TarifasCitables {
  const orden = [...extracciones].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  const revisada = orden.find((x) => x.estado === 'revisada') ?? null
  const borrador = orden.find((x) => x.estado === 'borrador') ?? null
  const porRevisar = !!borrador && (!revisada || borrador.created_at > revisada.created_at)
  if (!revisada) return { ...SIN_TARIFAS, porRevisar }
  const vigencia = { desde: fecha(revisada.vigencia_desde), hasta: fecha(revisada.vigencia_hasta) }
  return { citable: true, vigencia, cubre: cubreFechas(vigencia, fechas), porRevisar }
}

/**
 * Las de varios proveedores de una vez. `tarifarioDe` = de quién son las extracciones de cada ficha
 * (la ficha de una sucursal toma las de su cadena, `fotos_perfiles.tarifario_de_id`).
 */
export function tarifasCitablesPorProveedor(
  fichas: readonly { id: string; tarifario_de_id?: string | null }[],
  extracciones: readonly ExtraccionParaCitar[],
  fechas?: { inicio: string | null; fin: string | null } | null,
): Map<string, TarifasCitables> {
  const porDueno = new Map<string, ExtraccionParaCitar[]>()
  for (const x of extracciones) porDueno.set(x.proveedor_id, [...(porDueno.get(x.proveedor_id) ?? []), x])
  const salida = new Map<string, TarifasCitables>()
  for (const f of fichas) salida.set(f.id, tarifasCitables(porDueno.get(f.tarifario_de_id || f.id) ?? [], fechas))
  return salida
}
