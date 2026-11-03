/**
 * Cómo van las fotos en las fichas de hotel de la propuesta (regla de Ren del 2026-10-29, con las
 * correcciones de Mauricio del mismo día y su aprobación del PDF final). Puro.
 *
 *  · La ficha muestra las fotos buenas que tenga el hotel en hasta 3 CASILLAS del mismo tamaño, una
 *    al lado de la otra: 3 iguales, 2 iguales o una sola a todo lo ancho. Una foto de paneles iguales
 *    (un díptico o un tríptico del sitio oficial, `paneles.ts`) ocupa tantas casillas como paneles
 *    tenga. Nunca un recuadro vacío ni un relleno. Los collages irregulares y las verticales no
 *    llegan aquí.
 *  · Ninguna foto se recorta más de `RECORTE_MAXIMO` (la fracción de la foto que queda fuera de su
 *    recuadro), centrada en su foco. Si una foto no deja un alto común con las demás sin pasar de
 *    ahí, no se usa (se quedan las primeras, en su orden, que sí lo dejen).
 *  · El alto: si un mismo alto les sirve a TODAS las fichas del documento, todas lo llevan (como el
 *    PDF final de la COT-2026-0008 que aprobó Mauricio). Si no, por filas: se emparejan, dentro de la
 *    misma ciudad, las fichas que admiten un alto común; sin pareja compatible, cada una con su alto,
 *    arriba alineadas. Dentro de lo que sirve, el alto que menos recorta la foto más recortada.
 */

/**
 * Cuánto se puede recortar una foto, como fracción de su área. Ren pidió «cerca del 15 %»; con la
 * aprobación del PDF final (2026-10-29) se aceptó hasta cerca del 17 % para que las fichas queden
 * del mismo alto.
 */
export const RECORTE_MAXIMO = 0.17
/** Separación entre fotos dentro del recuadro. */
export const ESPACIO_FOTOS_MM = 0.6
/** Cuántas casillas tiene como máximo una ficha. */
export const FOTOS_POR_FICHA = 3
/** El alto se busca en pasos de este tamaño (mm). */
const PASO_MM = 0.5
/** Una foto sin medida (una de prueba, una que no se pudo medir) se trata como 3:2. */
const PROPORCION_SUPUESTA = 1.5

const forma = (p: number | null | undefined) => (typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : PROPORCION_SUPUESTA)

/** Una foto de la ficha: su forma y cuántas casillas ocupa (sus paneles). */
export interface FotoParaFicha {
  proporcion?: number | null
  paneles?: number | null
}

const panelesDe = (f: FotoParaFicha) => Math.max(1, Math.min(FOTOS_POR_FICHA, Math.round(f.paneles ?? 1)))

/** La fracción de una foto de forma `foto` que queda por fuera de un recuadro de forma `recuadro`. */
export function recorte(foto: number, recuadro: number): number {
  if (!(foto > 0) || !(recuadro > 0)) return 1
  return 1 - Math.min(foto / recuadro, recuadro / foto)
}

/** El ancho de cada casilla con `n` casillas lado a lado en un recuadro de `ancho` mm. */
export function anchoDeCasilla(ancho: number, n: number): number {
  return (ancho - ESPACIO_FOTOS_MM * (n - 1)) / n
}

/** El ancho del recuadro de una foto que ocupa `paneles` casillas de `n`. */
export function anchoDeFoto(ancho: number, n: number, paneles: number): number {
  return anchoDeCasilla(ancho, n) * paneles + ESPACIO_FOTOS_MM * (paneles - 1)
}

type Rango = readonly [number, number]

const casillasDe = (fotos: readonly FotoParaFicha[]) => fotos.reduce((s, f) => s + panelesDe(f), 0)

/**
 * Los altos (mm) con que `fotos`, lado a lado en casillas iguales, caben sin recortar ninguna más
 * de `RECORTE_MAXIMO`. `null` si no hay ninguno.
 */
export function rangoDeAltos(fotos: readonly FotoParaFicha[], ancho: number): Rango | null {
  const n = casillasDe(fotos)
  if (n === 0 || n > FOTOS_POR_FICHA) return null
  const queda = 1 - RECORTE_MAXIMO
  let bajo = 0
  let alto = Infinity
  for (const f of fotos) {
    const w = anchoDeFoto(ancho, n, panelesDe(f))
    const p = forma(f.proporcion)
    bajo = Math.max(bajo, (w * queda) / p)
    alto = Math.min(alto, w / (p * queda))
  }
  return bajo <= alto + 1e-9 ? [bajo, alto] : null
}

const cruce = (a: Rango, b: Rango): Rango | null => {
  const r: Rango = [Math.max(a[0], b[0]), Math.min(a[1], b[1])]
  return r[0] <= r[1] + 1e-9 ? r : null
}

/** El peor recorte de una ficha con ese alto. */
function peorRecorte(fotos: readonly FotoParaFicha[], ancho: number, alto: number): number {
  const n = casillasDe(fotos)
  return Math.max(...fotos.map((f) => recorte(forma(f.proporcion), anchoDeFoto(ancho, n, panelesDe(f)) / alto)))
}

/** Dentro del rango, el alto (al medio milímetro) que menos recorta la foto más recortada de todas. */
function mejorAlto(r: Rango, fichas: readonly (readonly FotoParaFicha[])[], ancho: number): number {
  let mejor = Math.round(r[0] * 10) / 10
  let menor = Infinity
  for (let a = Math.ceil(r[0] / PASO_MM - 1e-9) * PASO_MM; a <= r[1] + 1e-9; a += PASO_MM) {
    const peor = Math.max(...fichas.map((f) => peorRecorte(f, ancho, a)))
    if (peor < menor - 1e-9) {
      menor = peor
      mejor = a
    }
  }
  return mejor
}

export interface FotosDeFicha {
  /** Los índices (en la lista de la ficha) de las fotos que salen, en su orden. */
  fotos: number[]
  /** Cuántas casillas ocupan entre todas (1 a 3; 0 = sin foto). */
  casillas: number
  /** Los altos que admiten; `null` = la ficha va sin foto. */
  rango: Rango | null
}

/** Las fotos de una ficha: las que más casillas llenen juntas (hasta 3), las primeras en su orden. */
export function fotosDeFicha(fotos: readonly FotoParaFicha[], ancho: number): FotosDeFicha {
  let mejor: FotosDeFicha = { fotos: [], casillas: 0, rango: null }
  for (let k = Math.min(FOTOS_POR_FICHA, fotos.length); k >= 1; k--) {
    for (const c of combinaciones(fotos.length, k)) {
      const elegidas = c.map((i) => fotos[i])
      const casillas = casillasDe(elegidas)
      if (casillas > FOTOS_POR_FICHA || casillas <= mejor.casillas) continue
      const rango = rangoDeAltos(elegidas, ancho)
      if (rango) mejor = { fotos: c, casillas, rango }
    }
  }
  return mejor
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
 * Las filas de `columnas` fichas y el alto de cada una. `fotos[i]` = las fotos que salen en la
 * ficha `i` (ya escogidas por `fotosDeFicha`).
 */
export function filasDeFichas(
  fichas: readonly FotosDeFicha[],
  fotos: readonly (readonly FotoParaFicha[])[],
  ciudades: readonly (string | null)[],
  columnas: number,
  ancho: number,
): FilaDeFichas[] {
  const conFoto = fichas.map((_, i) => i).filter((i) => fichas[i].rango !== null)
  // Un mismo alto para todo el documento, si lo hay.
  const todas = conFoto.reduce<Rango | null | undefined>((acc, i) => (acc === undefined ? fichas[i].rango : acc && cruce(acc, fichas[i].rango!)), undefined)
  const comunDelDocumento = todas ? mejorAlto(todas, conFoto.map((i) => fotos[i]), ancho) : null
  const pendientes = fichas.map((_, i) => i)
  const filas: FilaDeFichas[] = []
  while (pendientes.length > 0) {
    const fila = [pendientes.shift()!]
    let comun: Rango | null = fichas[fila[0]].rango
    while (fila.length < columnas && pendientes.length > 0) {
      const compatible = comunDelDocumento !== null ? pendientes[0] : pendientes.find((j) => {
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
    const deLaFila = fila.filter((i) => fichas[i].rango !== null)
    const juntos = deLaFila.reduce<Rango | null | undefined>((acc, i) => (acc === undefined ? fichas[i].rango : acc && cruce(acc, fichas[i].rango!)), undefined)
    const alineada = comunDelDocumento !== null || deLaFila.length <= 1 || !!juntos
    const altoDeFila = comunDelDocumento ?? (juntos ? mejorAlto(juntos, deLaFila.map((i) => fotos[i]), ancho) : null)
    filas.push({
      fichas: fila,
      altos: fila.map((i) => (fichas[i].rango ? altoDeFila ?? mejorAlto(fichas[i].rango!, [fotos[i]], ancho) : null)),
      alineada,
    })
  }
  return filas
}

/** Cuántas casillas le faltan a una ficha para tener las 3. */
export function fotosQueFaltan(f: FotosDeFicha): number {
  return FOTOS_POR_FICHA - f.casillas
}
