/**
 * ¿Está la foto partida en paneles iguales? (díptico o tríptico del sitio oficial de un hotel). La
 * forma sola no lo dice: una panorámica de 2,8 también es ancha. Lo dicen los píxeles: en cada corte
 * (1/2, o 1/3 y 2/3 del ancho) hay una franja de separación de lado a lado (casi blanca o casi negra
 * y pareja) o un salto brusco que atraviesa casi toda la altura. Una foto de verdad rara vez tiene
 * un borde recto vertical de arriba abajo justo ahí.
 *
 * Aprobado por Mauricio con el PDF final del 2026-10-29: la foto de paneles iguales ocupa tantas
 * casillas de la ficha como paneles tenga; los collages irregulares se siguen frenando.
 */
import sharp from 'sharp'

import { panelesPosibles } from './forma'

const ANCHO_MUESTRA = 360
const ALTO_MUESTRA = 120
/** Cuánto se busca el corte a cada lado de donde debería estar (fracción del ancho). */
const HOLGURA = 0.03

/** ¿La columna `x` es una separación o un corte de lado a lado? */
function esCorte(gris: Uint8Array | Buffer, ancho: number, alto: number, x: number): boolean {
  let claros = 0
  let oscuros = 0
  let saltos = 0
  let suma = 0
  let suma2 = 0
  for (let y = 0; y < alto; y++) {
    const v = gris[y * ancho + x]
    suma += v
    suma2 += v * v
    if (v >= 225) claros++
    if (v <= 25) oscuros++
    if (x + 1 < ancho && Math.abs(v - gris[y * ancho + x + 1]) > 30) saltos++
  }
  const media = suma / alto
  const desvio = Math.sqrt(Math.max(0, suma2 / alto - media * media))
  const franja = (claros >= alto * 0.9 || oscuros >= alto * 0.9) && desvio < 14
  return franja || saltos >= alto * 0.75
}

/** Los paneles de una imagen en gris (`ancho` × `alto`, un byte por píxel) con forma `proporcion`. */
export function panelesDeGris(gris: Uint8Array | Buffer, ancho: number, alto: number, proporcion: number): number {
  for (const n of panelesPosibles(proporcion)) {
    const todos = Array.from({ length: n - 1 }, (_, i) => (i + 1) / n).every((f) => {
      const desde = Math.max(1, Math.floor((f - HOLGURA) * ancho))
      const hasta = Math.min(ancho - 2, Math.ceil((f + HOLGURA) * ancho))
      for (let x = desde; x <= hasta; x++) if (esCorte(gris, ancho, alto, x)) return true
      return false
    })
    if (todos) return n
  }
  return 1
}

/** Cuántos paneles iguales tiene la foto (1 = no está partida, o no se pudo leer). */
export async function panelesDeFoto(datos: Buffer, proporcion: number): Promise<number> {
  if (panelesPosibles(proporcion).length === 0) return 1
  try {
    const { data, info } = await sharp(datos)
      .rotate()
      .greyscale()
      .toColourspace('b-w')
      .resize({ width: ANCHO_MUESTRA, height: ALTO_MUESTRA, fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true })
    return panelesDeGris(data, info.width, info.height, proporcion)
  } catch {
    return 1
  }
}
