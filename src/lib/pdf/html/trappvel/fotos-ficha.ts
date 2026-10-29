/**
 * Cómo van las fotos en las fichas de hotel de la propuesta (regla de Ren del 2026-10-29, con la
 * segunda corrección de Mauricio del mismo día). Puro.
 *
 *  · La ficha muestra las fotos buenas que tenga el hotel, hasta 3, TODAS DEL MISMO TAMAÑO y una al
 *    lado de la otra: 3 iguales, 2 iguales o una sola a todo lo ancho. Nunca un recuadro vacío ni un
 *    relleno. La que ya es un collage o una vertical no llega aquí (`formaAdmitida`).
 *  · Ninguna foto se recorta más de `RECORTE_MAXIMO` (la fracción de la foto que queda fuera de su
 *    casilla), centrada en su foco. Si una foto no deja un alto común con las demás sin pasar de ahí,
 *    no se usa (se quedan las primeras, en su orden, que sí lo dejen).
 *
 * El choque: con el ancho fijo de la ficha, una foto sola a todo lo ancho pide un recuadro alto
 * (≈ 60–80 mm con fotos de 4:3), y tres lado a lado uno bajo (≈ 20–27 mm). Un alto común para todas
 * las fichas obligaría a recortar de más o a dejar casillas vacías. Salida: cada ficha tiene el alto
 * que le sirve a SUS fotos (el más bajo dentro del 15 %), y las dos fichas de cada fila van
 * alineadas: se emparejan, dentro de la misma ciudad, las que admiten un mismo alto (`filasDeFichas`),
 * y la fila usa ese alto. Si una ficha no tiene pareja compatible, va con la siguiente y cada una con
 * su alto, arriba alineadas.
 */

/** Cuánto se puede recortar una foto, como fracción de su área («cerca del 15 %»). */
export const RECORTE_MAXIMO = 0.15
/** Separación entre fotos dentro del recuadro. */
export const ESPACIO_FOTOS_MM = 0.6
/** Cuántas fotos lleva como máximo una ficha. */
export const FOTOS_POR_FICHA = 3
/** El alto se redondea hacia arriba a este paso (mm). */
const PASO_MM = 0.5
/** Una foto sin medida (una de prueba, una que no se pudo medir) se trata como 3:2. */
const PROPORCION_SUPUESTA = 1.5

const forma = (p: number | null | undefined) => (typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : PROPORCION_SUPUESTA)

/** La fracción de una foto de forma `foto` que queda por fuera de un recuadro de forma `recuadro`. */
export function recorte(foto: number, recuadro: number): number {
  if (!(foto > 0) || !(recuadro > 0)) return 1
  return 1 - Math.min(foto / recuadro, recuadro / foto)
}

/** El ancho de cada casilla con `n` fotos lado a lado en un recuadro de `ancho` mm. */
export function anchoDeCasilla(ancho: number, n: number): number {
  return (ancho - ESPACIO_FOTOS_MM * (n - 1)) / n
}

type Rango = readonly [number, number]

/**
 * Los altos (mm) con que `proporciones`, lado a lado e iguales, caben sin recortar ninguna más del
 * 15 %. `null` si no hay ninguno.
 */
export function rangoDeAltos(proporciones: readonly (number | null | undefined)[], ancho: number): Rango | null {
  if (proporciones.length === 0) return null
  const b = anchoDeCasilla(ancho, proporciones.length)
  const queda = 1 - RECORTE_MAXIMO
  let bajo = 0
  let alto = Infinity
  for (const x of proporciones) {
    const p = forma(x)
    bajo = Math.max(bajo, (b * queda) / p)
    alto = Math.min(alto, b / (p * queda))
  }
  return bajo <= alto + 1e-9 ? [bajo, alto] : null
}

const cruce = (a: Rango, b: Rango): Rango | null => {
  const r: Rango = [Math.max(a[0], b[0]), Math.min(a[1], b[1])]
  return r[0] <= r[1] + 1e-9 ? r : null
}

/** El alto más bajo del rango, redondeado hacia arriba al paso sin salirse. */
function altoDe(r: Rango): number {
  const redondo = Math.ceil(r[0] / PASO_MM - 1e-9) * PASO_MM
  return redondo <= r[1] + 1e-9 ? redondo : Math.round(r[0] * 10) / 10
}

export interface FotosDeFicha {
  /** Los índices (en la lista de la ficha) de las fotos que salen, en su orden. */
  fotos: number[]
  /** Los altos que admiten; `null` = la ficha va sin foto. */
  rango: Rango | null
}

/** Las fotos de una ficha: las más que quepan juntas (hasta 3), las primeras en su orden. */
export function fotosDeFicha(proporciones: readonly (number | null | undefined)[], ancho: number): FotosDeFicha {
  const n = proporciones.length
  for (let k = Math.min(FOTOS_POR_FICHA, n); k >= 1; k--) {
    for (const c of combinaciones(n, k)) {
      const rango = rangoDeAltos(c.map((i) => proporciones[i]), ancho)
      if (rango) return { fotos: c, rango }
    }
  }
  return { fotos: [], rango: null }
}

function combinaciones(n: number, k: number): number[][] {
  const salida: number[][] = []
  const ir = (desde: number, actual: number[]) => {
    if (actual.length === k) return void salida.push(actual)
    for (let i = desde; i < n; i++) ir(i + 1, [...actual, i])
  }
  ir(0, [])
  return salida
}

export interface FilaDeFichas {
  /** Las fichas de la fila (índices en el orden del documento). */
  fichas: number[]
  /** El alto del recuadro de foto de cada ficha de la fila, en el mismo orden (`null` = sin foto). */
  altos: (number | null)[]
  /** Las fichas con foto de la fila comparten el alto. */
  alineada: boolean
}

/**
 * Las filas de `columnas` fichas: a cada ficha, en orden, se le busca pareja en la MISMA ciudad que
 * admita un alto común; si no hay, va con la siguiente. La fila alineada usa el alto más bajo que les
 * sirve a todas; la que no, cada ficha el suyo.
 */
export function filasDeFichas(fichas: readonly FotosDeFicha[], ciudades: readonly (string | null)[], columnas: number): FilaDeFichas[] {
  const pendientes = fichas.map((_, i) => i)
  const filas: FilaDeFichas[] = []
  while (pendientes.length > 0) {
    const fila = [pendientes.shift()!]
    let comun: Rango | null = fichas[fila[0]].rango
    while (fila.length < columnas && pendientes.length > 0) {
      const compatible = pendientes.find((j) => {
        if (ciudades[j] !== ciudades[fila[0]]) return false
        const r = fichas[j].rango
        return comun === null || r === null ? comun === null && r === null : cruce(comun, r) !== null
      })
      const j = compatible ?? pendientes[0]
      pendientes.splice(pendientes.indexOf(j), 1)
      fila.push(j)
      const r = fichas[j].rango
      comun = comun && r ? cruce(comun, r) : comun ?? r
    }
    const conFoto = fila.filter((i) => fichas[i].rango !== null)
    const juntos = conFoto.reduce<Rango | null>((acc, i) => (acc === null ? fichas[i].rango : cruce(acc, fichas[i].rango!)), null)
    const alineada = conFoto.length <= 1 || (juntos !== null && conFoto.every((i) => cruce(juntos, fichas[i].rango!) !== null))
    const altoComun = alineada && juntos ? altoDe(juntos) : null
    filas.push({
      fichas: fila,
      altos: fila.map((i) => (fichas[i].rango ? altoComun ?? altoDe(fichas[i].rango!) : null)),
      alineada,
    })
  }
  return filas
}

/** Cuántas fotos le faltan a una ficha para tener las 3. */
export function fotosQueFaltan(f: FotosDeFicha): number {
  return FOTOS_POR_FICHA - f.fotos.length
}
