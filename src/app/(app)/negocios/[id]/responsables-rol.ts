/**
 * Cómo se nombra a un responsable en el detalle del negocio: con su área
 * («Comercial · Tatiana Cortés») y el nombre completo, sin truncar.
 *
 * `negocio_responsables.rol` es 'comercial' | 'operaciones' | null. Null (staff
 * financiero o sin área declarada) muestra solo el nombre: no se inventa etiqueta.
 */

export type ResponsableConRol = { id: string; full_name: string; rol?: string | null }

const ETIQUETAS: Record<string, string> = {
  comercial: 'Comercial',
  operaciones: 'Operaciones',
}

const ORDEN: Record<string, number> = { comercial: 0, operaciones: 1 }

/** 'Comercial' | 'Operaciones' | null (rol ausente o desconocido: sin etiqueta). */
export function etiquetaRol(rol: string | null | undefined): string | null {
  if (!rol) return null
  return ETIQUETAS[rol] ?? null
}

/** Comercial primero, luego operaciones, luego sin rol. Estable dentro de cada grupo; no muta. */
export function ordenarResponsables<T extends ResponsableConRol>(responsables: readonly T[]): T[] {
  const peso = (r: T) => (r.rol != null && r.rol in ORDEN ? ORDEN[r.rol] : 2)
  return responsables
    .map((r, i) => ({ r, i }))
    .sort((a, b) => peso(a.r) - peso(b.r) || a.i - b.i)
    .map(({ r }) => r)
}

/** Texto de la ficha: «Comercial · Tatiana Cortés», o solo el nombre si no hay rol. */
export function textoResponsable(r: ResponsableConRol): string {
  const etiqueta = etiquetaRol(r.rol)
  return etiqueta ? `${etiqueta} · ${r.full_name}` : r.full_name
}
