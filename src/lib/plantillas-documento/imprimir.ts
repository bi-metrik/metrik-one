/**
 * Plantilla editable → PDF con Chromium (el mismo motor de la propuesta de viaje).
 *
 * El HTML es el de `htmlDelDocumento`, el mismo que pinta la vista previa; aquí solo se le
 * inyectan las fuentes embebidas (Liberation Sans) y se imprime sin red.
 */
import { cssDeFuentes, inyectarEstilo } from '@/lib/pdf/chromium/recursos'
import { fuentesDeFormularios } from '@/lib/pdf/chromium/fuentes'
import { imprimirHtmlAPdf, type MedidasRender } from '@/lib/pdf/chromium/render-chromium'
import type { Contexto, Datos, TipoPlantilla } from './catalogo'
import { htmlDelDocumento } from './html'

export type ResultadoImpresion =
  | { ok: true; pdf: Buffer; medidas: MedidasRender }
  | { ok: false; error: string }

export function htmlImprimible(html: string): string {
  return inyectarEstilo(html, cssDeFuentes(fuentesDeFormularios()))
}

export async function imprimirPlantilla(
  tipo: TipoPlantilla,
  contenido: string,
  datos: Datos,
  ctx: Contexto,
): Promise<ResultadoImpresion> {
  const r = htmlDelDocumento(tipo, contenido, datos, ctx)
  if (!r.ok) return { ok: false, error: `La plantilla tiene errores: ${r.errores.slice(0, 3).join(' · ')}` }
  try {
    const { pdf, medidas } = await imprimirHtmlAPdf(htmlImprimible(r.html), { timeoutMs: 40_000 })
    return { ok: true, pdf, medidas }
  } catch (err) {
    console.error('[plantillas-documento] Chromium falló:', err)
    return { ok: false, error: 'No se pudo imprimir el PDF con la plantilla editable. Intenta de nuevo en un momento.' }
  }
}
