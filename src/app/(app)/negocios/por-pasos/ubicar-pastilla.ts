/**
 * Dónde va la pastilla de «Lo que suma» en el encabezado fijo del negocio (brief del 2026-10-16,
 * D1 y D2 de Vera; diseño de Noor). La pastilla va ENCIMA del encabezado (posición absoluta), así
 * que nunca lo hace crecer; lo que se decide aquí es en qué hueco libre cabe sin tocar nada:
 *
 *  1. En su renglón (el del viaje; sin viaje, V8, el del título), a la derecha: «Total $X · margen
 *     Y %», y si no cabe «$X · Y %», y si no solo «$X» (con el punto).
 *  2. Si ni el total cabe, sube al renglón de los botones («Avanzar de etapa»…), a la izquierda de
 *     ellos, con el texto más largo que quepa ahí.
 *  3. Nunca baja a un renglón propio. Si no hay hueco en ninguno de los dos, `null`.
 *
 * Todo en coordenadas de la ventana (px). Función pura: el componente mide y la llama.
 */

export type TextoPastilla = 'largo' | 'corto' | 'total'

export interface Caja {
  x: number
  y: number
  /** Borde derecho. */
  r: number
  /** Borde inferior. */
  b: number
}

export interface RenglonPastilla {
  nombre: 'inicio' | 'botones'
  /** Hasta dónde llega la pastilla por la derecha. */
  derecha: number
  /** La pastilla se centra, si puede, en esta altura (el centro de la última línea del renglón). */
  centro: number
  /** Franja vertical en la que puede quedar la pastilla (arriba y abajo de su caja). */
  arriba: number
  abajo: number
}

export interface UbicacionPastilla {
  renglon: RenglonPastilla['nombre']
  texto: TextoPastilla
  x: number
  y: number
  ancho: number
}

/** Aire mínimo entre la pastilla y lo que tiene al lado (px). */
const AIRE_X = 8
const AIRE_Y = 1

const ORDEN_TEXTOS: TextoPastilla[] = ['largo', 'corto', 'total']

function choca(c: Caja, obstaculos: readonly Caja[]): boolean {
  return obstaculos.some(o => o.x < c.r + AIRE_X && o.r > c.x - AIRE_X && o.y < c.b + AIRE_Y && o.b > c.y - AIRE_Y)
}

export function ubicarPastilla(e: {
  /** Ancho de la pastilla con cada texto (con su borde, relleno y punto). */
  anchos: Record<TextoPastilla, number>
  alto: number
  /** En orden de preferencia: su renglón primero, después el de los botones. */
  renglones: readonly RenglonPastilla[]
  /** Todo lo que se ve en el encabezado: líneas de texto, botones, etiquetas con fondo. */
  obstaculos: readonly Caja[]
  /** El borde izquierdo del contenido del encabezado: la pastilla no sale de ahí. */
  izquierda: number
}): UbicacionPastilla | null {
  for (const renglon of e.renglones) {
    for (const texto of ORDEN_TEXTOS) {
      const ancho = e.anchos[texto]
      if (!(ancho > 0)) continue
      const x = renglon.derecha - ancho
      if (x < e.izquierda) continue
      const minY = renglon.arriba
      const maxY = renglon.abajo - e.alto
      if (maxY < minY) continue
      // Lo más cerca posible del centro de la última línea, buscando hacia arriba y hacia abajo.
      const ideal = Math.min(maxY, Math.max(minY, renglon.centro - e.alto / 2))
      const pasos = Math.ceil(Math.max(ideal - minY, maxY - ideal))
      for (let d = 0; d <= pasos; d++) {
        for (const y of d === 0 ? [ideal] : [ideal - d, ideal + d]) {
          if (y < minY || y > maxY) continue
          if (!choca({ x, y, r: x + ancho, b: y + e.alto }, e.obstaculos)) return { renglon: renglon.nombre, texto, x, y, ancho }
        }
      }
    }
  }
  return null
}
