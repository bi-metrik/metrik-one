/**
 * «La última hoja trabaja» (§4.11, puntos 6 y 8, del sistema visual de Trappvel): compone el
 * documento, lo MIDE ya renderizado y, si hace falta, lo recompone.
 *
 * - Punto 6: si la última hoja ocupa menos del 35 % de su alto útil, se recompone aplicando
 *   en orden el espaciado compacto, las fotos de las alternativas a 1/4 y la foto de ciudad
 *   del capítulo a 110 pt, y se para en cuanto la última hoja desaparece o pasa del 35 %.
 * - Punto 8: si no hizo falta el punto 6 pero un salto dejó más del 25 % en blanco al pie de
 *   una hoja, se recompone en compacto lo que hay en esa hoja (y la sección que saltó) para
 *   ver si la unidad entra; si no entra, se queda la composición normal.
 *
 * Costo acotado: nunca más de `MAXIMO_DE_RENDERS` (4) renders por documento.
 *
 * Nunca se achica texto ni se quita contenido: los pasos solo cambian espacios y el tamaño de
 * fotos. Si después de los tres pasos la última hoja sigue sin trabajar, se acepta la hoja con
 * la composición NORMAL: los pasos no lograron su objeto y solo dejarían fotos más chicas.
 */
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'

import CotizacionTrappvelPDF from './cotizacion-trappvel-pdf'
import type { CotizacionPDFProps } from './cotizacion-props'
import {
  HOJA,
  MAXIMO_DE_RENDERS,
  hojasConHueco,
  ocupacionDeHoja,
  recomposicionCumple,
  seccionDeNumero,
  seccionesParaCerrarHueco,
  ultimaHojaTrabaja,
  type Composicion,
  type MedidaDeHojas,
  type NivelDeCompactacion,
} from './cotizacion-trappvel-formato'
import { medirPDF } from './medir-pdf'

/** Qué se hizo para componer el documento: para el registro y para el QA (punto 9). */
export interface InformeDeComposicion {
  /** Cuántas veces se renderizó (1 a 4). */
  renders: number
  /** La composición que se entregó. */
  composicion: Composicion
  /** Hojas y ocupación de la última, en la primera composición (normal). */
  antes: { hojas: number; ocupacionUltima: number }
  /** Hojas y ocupación de la última, en la que se entregó. */
  despues: { hojas: number; ocupacionUltima: number }
  /** Hojas (desde 1) que en la composición entregada terminan con un blanco al pie > 25 %. */
  huecos: number[]
  /** Por qué se recompuso, en palabras: lo que se reporta. */
  motivo: 'ninguno' | 'ultima-hoja' | 'hueco-al-pie'
  /** Si se intentó recomponer y no sirvió, y por eso se entrega la normal. */
  descartado: boolean
}

/** El encabezado fijo termina antes de esta línea y el pie empieza después de esta otra. */
const FRANJA = { arriba: HOJA.arriba - 8, abajo: HOJA.alto - HOJA.altoPie - 1 }

/** Lo que el paso de composición mira de un PDF ya renderizado. */
export function medidaDeHojas(pdf: Buffer): MedidaDeHojas {
  const m = medirPDF(pdf, FRANJA)
  const inicios = new Map<string, number>()
  for (const [n, { hoja }] of m.marcas) {
    const seccion = seccionDeNumero(n)
    if (seccion) inicios.set(seccion, hoja)
  }
  return { fondos: m.hojas.map(h => h.fondo), inicios }
}

const resumen = (m: MedidaDeHojas) => ({
  hojas: m.fondos.length,
  ocupacionUltima: ocupacionDeHoja(m.fondos[m.fondos.length - 1] ?? null),
})

export interface Renderizador {
  (props: CotizacionPDFProps & { composicion: Composicion }): Promise<Buffer>
}

/** El render de verdad: la plantilla de Trappvel por @react-pdf. */
export const renderizarTrappvel: Renderizador = async props =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Buffer.from(await renderToBuffer(createElement(CotizacionTrappvelPDF, props) as any))

/**
 * Compone la cotización de Trappvel siguiendo el §4.11 y devuelve el PDF con su informe.
 * `renderizar` se puede cambiar en pruebas; por defecto es el render real.
 */
export async function componerCotizacionTrappvel(
  props: CotizacionPDFProps,
  renderizar: Renderizador = renderizarTrappvel,
): Promise<{ pdf: Buffer; informe: InformeDeComposicion }> {
  let renders = 0
  const componer = async (composicion: Composicion) => {
    renders += 1
    const pdf = await renderizar({ ...props, composicion })
    return { pdf, medida: medidaDeHojas(pdf), composicion }
  }
  const normal = await componer({ nivel: 0 })
  const informe = (
    r: typeof normal,
    motivo: InformeDeComposicion['motivo'],
    descartado = false,
  ): { pdf: Buffer; informe: InformeDeComposicion } => ({
    pdf: r.pdf,
    informe: {
      renders,
      composicion: r.composicion,
      antes: resumen(normal.medida),
      despues: resumen(r.medida),
      huecos: hojasConHueco(r.medida),
      motivo,
      descartado,
    },
  })

  // Punto 6: la última hoja no trabaja → los tres pasos, en orden, hasta que cumpla.
  if (!ultimaHojaTrabaja(normal.medida)) {
    for (const nivel of [1, 2, 3] as NivelDeCompactacion[]) {
      if (renders >= MAXIMO_DE_RENDERS) break
      const r = await componer({ nivel })
      if (recomposicionCumple(normal.medida, r.medida)) return informe(r, 'ultima-hoja')
    }
    return informe(normal, 'ultima-hoja', true)
  }

  // Punto 8: un salto dejó un blanco grande al pie → compacto lo de esa hoja, si así entra.
  const huecos = hojasConHueco(normal.medida)
  if (huecos.length > 0 && renders < MAXIMO_DE_RENDERS) {
    const compactas = [...new Set(huecos.flatMap(p => seccionesParaCerrarHueco(normal.medida, p)))]
    if (compactas.length > 0) {
      const r = await componer({ nivel: 0, compactas })
      const sirve = r.medida.fondos.length <= normal.medida.fondos.length
        && hojasConHueco(r.medida).length < huecos.length
        && ultimaHojaTrabaja(r.medida)
      return sirve ? informe(r, 'hueco-al-pie') : informe(normal, 'hueco-al-pie', true)
    }
  }

  return informe(normal, 'ninguno')
}
