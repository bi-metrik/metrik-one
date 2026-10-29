/**
 * Cómo van las fotos en las fichas de hotel de la propuesta (regla de Ren del 2026-10-29, con la
 * corrección de Mauricio del mismo día: «en los hoteles sí necesitamos ver el collage de las 3
 * fotos»). Puro.
 *
 *  · Toda ficha lleva la MISMA composición: una foto grande a la izquierda y dos pequeñas apiladas
 *    a la derecha, armada por ONE con tres fotos sueltas. La que ya es un collage (un tríptico) o
 *    una vertical no entra como una de las tres (`formaAdmitida`, antes de llegar aquí).
 *  · Todas las fichas del documento miden lo mismo: el alto y el reparto grande/pequeñas se
 *    escogen POR DOCUMENTO (`planDeFichas`).
 *  · Ninguna foto se recorta más de `RECORTE_MAXIMO` (la fracción de la foto que queda fuera de su
 *    casilla). Una foto que necesitaría más no se usa.
 *  · Con menos de tres fotos la composición no cambia: la casilla vacía lleva un tono suave de la
 *    marca (las dos pequeñas, juntas en un solo bloque, si faltan ambas). La asesora ve en «Revisar
 *    y enviar» cuántas le faltan a cada hotel (`fotosQueFaltan`).
 *
 * Se escoge, en este orden: más fotos puestas en todo el documento; con eso, el recuadro más bajo
 * (menos hojas); con eso, la grande más cerca de dos tercios del ancho.
 */

/** Cuánto se puede recortar una foto, como fracción de su área («cerca del 15 %»). */
export const RECORTE_MAXIMO = 0.15
/** Los altos que se prueban para el recuadro de foto, en mm. */
export const ALTO_FOTO_FICHA_MM = { minimo: 30, maximo: 55, paso: 0.5, sinFotos: 25 } as const
/** Separación entre fotos dentro del recuadro (la de `.img.mosaico`). */
export const ESPACIO_FOTOS_MM = 0.6
/** La grande ocupa entre algo más de la mitad y tres cuartos del ancho. */
const FRACCION_GRANDE = { minimo: 0.55, maximo: 0.75, paso: 0.01, ideal: 2 / 3 } as const
/** Cuántas fotos lleva una ficha. */
export const FOTOS_POR_FICHA = 3

/** Qué foto (índice en la lista de la ficha) va en cada casilla; `null` = el degradado. */
export interface CasillasFicha {
  grande: number | null
  arriba: number | null
  abajo: number | null
}

export interface PlanDeFichas {
  altoMm: number
  /** La fracción del ancho de la foto grande, la misma en todas las fichas. */
  grande: number
  /** Por ficha, en el orden de entrada. */
  fichas: CasillasFicha[]
}

/** Una foto sin medida (una de prueba, una que no se pudo medir) se trata como 3:2. */
const PROPORCION_SUPUESTA = 1.5
const forma = (p: number | null | undefined) => (typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : PROPORCION_SUPUESTA)

/** La fracción de una foto de forma `foto` que queda por fuera de un recuadro de forma `recuadro`. */
export function recorte(foto: number, recuadro: number): number {
  if (!(foto > 0) || !(recuadro > 0)) return 1
  return 1 - Math.min(foto / recuadro, recuadro / foto)
}

const cabe = (foto: number | null | undefined, recuadro: number) => recorte(forma(foto), recuadro) <= RECORTE_MAXIMO + 1e-9

/** La forma (ancho / alto) de la casilla grande y de cada pequeña. */
export function formasDeCasillas(ancho: number, alto: number, grande: number): { grande: number; pequena: number } {
  const util = ancho - ESPACIO_FOTOS_MM
  return { grande: (util * grande) / alto, pequena: (util * (1 - grande)) / ((alto - ESPACIO_FOTOS_MM) / 2) }
}

/**
 * Las casillas de una ficha: la grande, la primera foto (en su orden) que quepa; las pequeñas, las
 * siguientes que quepan.
 */
export function casillasDeFicha(proporciones: readonly (number | null | undefined)[], formas: { grande: number; pequena: number }): CasillasFicha {
  const usadas = new Set<number>()
  const tomar = (forma: number) => {
    const i = proporciones.findIndex((p, j) => !usadas.has(j) && cabe(p, forma))
    if (i < 0) return null
    usadas.add(i)
    return i
  }
  const grande = tomar(formas.grande)
  return { grande, arriba: tomar(formas.pequena), abajo: tomar(formas.pequena) }
}

const puestas = (c: CasillasFicha) => [c.grande, c.arriba, c.abajo].filter((x) => x !== null).length

/**
 * El alto común del recuadro de foto, el reparto y las casillas de cada ficha. `fichas` = por
 * ficha, las proporciones de sus fotos buenas en orden; `ancho` = el del recuadro, en mm.
 */
export function planDeFichas(fichas: readonly (readonly (number | null | undefined)[])[], ancho: number): PlanDeFichas {
  const vacias = (): CasillasFicha[] => fichas.map(() => ({ grande: null, arriba: null, abajo: null }))
  /** [fotos puestas, fichas con foto que la tienen en la grande, cercanía del reparto a 2/3]. */
  const puntaje = (plan: CasillasFicha[], grande: number): [number, number, number] => [
    plan.reduce((s, c) => s + puestas(c), 0),
    plan.filter((c) => c.grande !== null).length,
    -Math.abs(grande - FRACCION_GRANDE.ideal),
  ]
  const gana = (a: [number, number, number], b: [number, number, number]) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2] + 1e-9
  let mejor: { plan: PlanDeFichas; puntaje: [number, number, number] } | null = null
  const { minimo, maximo, paso } = ALTO_FOTO_FICHA_MM
  for (let alto = minimo; alto <= maximo + 1e-9; alto += paso) {
    const altoMm = Math.round(alto * 10) / 10
    for (let g = FRACCION_GRANDE.minimo; g <= FRACCION_GRANDE.maximo + 1e-9; g += FRACCION_GRANDE.paso) {
      const grande = Math.round(g * 100) / 100
      const plan = fichas.map((f) => casillasDeFicha(f, formasDeCasillas(ancho, altoMm, grande)))
      const p = puntaje(plan, grande)
      if (p[0] === 0) continue
      // Más fotos; luego la grande llena; a igual cosa gana el alto más bajo (el primero que llega);
      // en ese alto, el reparto más cerca de dos tercios.
      const mismoAlto = mejor?.plan.altoMm === altoMm
      if (!mejor || (p[0] !== mejor.puntaje[0] || p[1] !== mejor.puntaje[1] ? gana(p, mejor.puntaje) : mismoAlto && gana(p, mejor.puntaje))) {
        mejor = { plan: { altoMm, grande, fichas: plan }, puntaje: p }
      }
    }
  }
  return mejor?.plan ?? { altoMm: ALTO_FOTO_FICHA_MM.sinFotos, grande: FRACCION_GRANDE.ideal, fichas: vacias() }
}

/** Cuántas fotos le faltan a cada ficha para llenar sus tres casillas. */
export function fotosQueFaltan(plan: PlanDeFichas): number[] {
  return plan.fichas.map((c) => FOTOS_POR_FICHA - puestas(c))
}
