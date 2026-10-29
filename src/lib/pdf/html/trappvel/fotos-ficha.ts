/**
 * Cómo van las fotos en las fichas de hotel de la propuesta (regla de Ren, 2026-10-29). Puro.
 *
 *  · Según cuántas fotos buenas tenga el hotel: 1 = una sola a todo lo ancho; 2 = dos iguales;
 *    3 = una grande y dos apiladas, con el mismo alto total.
 *  · Todas las fichas del documento llevan el recuadro de foto del MISMO alto.
 *  · Ninguna foto se recorta más de `RECORTE_MAXIMO` (la fracción de la foto que queda por fuera
 *    del recuadro). Una foto que necesitaría más va en otra distribución que le sirva o no se usa.
 *
 * Con el ancho fijo de la ficha (dos columnas en carta), el alto decide qué cabe: una foto de 3:2
 * sola pide un recuadro alto (≈ 55–75 mm); dos de 3:2 lado a lado, uno bajo (≈ 27–38 mm). Por eso
 * el alto se escoge POR DOCUMENTO (`planDeFichas`), en este orden:
 *   1. que la mayor cantidad de hoteles lleve foto;
 *   2. con eso, que salgan la mayor cantidad de fotos;
 *   3. con eso, el recuadro más bajo (menos hojas).
 * Las fotos se toman en su orden (fachada → habitación → zonas comunes): la grande es la primera
 * que quepa.
 */

/** Cuánto se puede recortar una foto, como fracción de su área («cerca del 15 %»). */
export const RECORTE_MAXIMO = 0.15
/** El recuadro de hoy (25 mm) es el más bajo; el más alto no deja la ficha más alta que ancha. */
export const ALTO_FOTO_FICHA_MM = { minimo: 25, maximo: 70, paso: 0.5 } as const
/** Separación entre fotos dentro del recuadro (la de `.img.mosaico`). */
export const ESPACIO_FOTOS_MM = 0.6
/** La grande de tres ocupa entre la mitad y tres cuartos del ancho. */
const FRACCION_GRANDE = { minimo: 0.5, maximo: 0.75, paso: 0.01 } as const
/** Una foto sin medida se trata como 3:2. */
const PROPORCION_SUPUESTA = 1.5

export type DistribucionFicha =
  | { tipo: 'una'; fotos: [number] }
  | { tipo: 'dos'; fotos: [number, number] }
  /** `grande` = la fracción del ancho de la foto grande (la primera). */
  | { tipo: 'tres'; fotos: [number, number, number]; grande: number }

export interface PlanDeFichas {
  altoMm: number
  /** Por ficha, en el orden de entrada; `null` = la ficha va sin foto. */
  fichas: (DistribucionFicha | null)[]
}

const forma = (p: number | null | undefined) => (typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : PROPORCION_SUPUESTA)

/** La fracción de una foto de forma `foto` que queda por fuera de un recuadro de forma `recuadro`. */
export function recorte(foto: number, recuadro: number): number {
  if (!(foto > 0) || !(recuadro > 0)) return 1
  return 1 - Math.min(foto / recuadro, recuadro / foto)
}

const cabe = (foto: number, recuadro: number) => recorte(foto, recuadro) <= RECORTE_MAXIMO + 1e-9

/** Las combinaciones de `k` índices de `0..n-1`, en orden (las primeras fotos primero). */
function combinaciones(n: number, k: number): number[][] {
  const salida: number[][] = []
  const ir = (desde: number, actual: number[]) => {
    if (actual.length === k) return void salida.push(actual)
    for (let i = desde; i < n; i++) ir(i + 1, [...actual, i])
  }
  ir(0, [])
  return salida
}

/** La mejor fracción de la grande para tres fotos en un recuadro `ancho × alto`; `null` si no caben. */
function fraccionParaTres(p: [number, number, number], ancho: number, alto: number): number | null {
  const util = ancho - ESPACIO_FOTOS_MM
  const altoChica = (alto - ESPACIO_FOTOS_MM) / 2
  let mejor: number | null = null
  let peor = Infinity
  for (let a = FRACCION_GRANDE.minimo; a <= FRACCION_GRANDE.maximo + 1e-9; a += FRACCION_GRANDE.paso) {
    const r = Math.max(recorte(p[0], (util * a) / alto), recorte(p[1], (util * (1 - a)) / altoChica), recorte(p[2], (util * (1 - a)) / altoChica))
    if (r <= RECORTE_MAXIMO + 1e-9 && r < peor - 1e-9) {
      peor = r
      mejor = Math.round(a * 100) / 100
    }
  }
  return mejor
}

/** La distribución con más fotos que cabe en un recuadro `ancho × alto`; `null` si ninguna. */
export function distribucionDeFicha(proporciones: readonly (number | null | undefined)[], ancho: number, alto: number): DistribucionFicha | null {
  const p = proporciones.map(forma)
  for (const c of combinaciones(p.length, 3)) {
    const grande = fraccionParaTres([p[c[0]], p[c[1]], p[c[2]]], ancho, alto)
    if (grande !== null) return { tipo: 'tres', fotos: [c[0], c[1], c[2]], grande }
  }
  const mitad = (ancho - ESPACIO_FOTOS_MM) / 2 / alto
  for (const c of combinaciones(p.length, 2)) {
    if (cabe(p[c[0]], mitad) && cabe(p[c[1]], mitad)) return { tipo: 'dos', fotos: [c[0], c[1]] }
  }
  for (let i = 0; i < p.length; i++) if (cabe(p[i], ancho / alto)) return { tipo: 'una', fotos: [i] }
  return null
}

const cuantas = (d: DistribucionFicha | null) => d?.fotos.length ?? 0

/**
 * El alto común del recuadro de foto y la distribución de cada ficha. `fichas` = por ficha, las
 * proporciones de sus fotos buenas en orden; `ancho` = el del recuadro, en mm.
 */
export function planDeFichas(fichas: readonly (readonly (number | null | undefined)[])[], ancho: number): PlanDeFichas {
  let mejor: PlanDeFichas | null = null
  let puntaje: [number, number] = [0, 0]
  const { minimo, maximo, paso } = ALTO_FOTO_FICHA_MM
  for (let alto = minimo; alto <= maximo + 1e-9; alto += paso) {
    const altoMm = Math.round(alto * 10) / 10
    const plan = fichas.map((f) => distribucionDeFicha(f, ancho, altoMm))
    const conFoto = plan.filter((d) => d !== null).length
    const fotos = plan.reduce((s, d) => s + cuantas(d), 0)
    // Más hoteles con foto; luego más fotos; a igual cosa, gana el más bajo (el primero).
    if (conFoto > puntaje[0] || (conFoto === puntaje[0] && fotos > puntaje[1])) {
      puntaje = [conFoto, fotos]
      mejor = { altoMm, fichas: plan }
    }
  }
  return mejor ?? { altoMm: minimo, fichas: fichas.map(() => null) }
}
