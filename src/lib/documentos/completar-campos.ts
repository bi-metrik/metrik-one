/**
 * Agregar campos extraídos NUEVOS a un documento ya procesado, sin tocar los que tiene.
 *
 * Existe porque el reproceso no sirve para esto: vuelve a extraer TODOS los campos y
 * pisa lo que el bloque ya tenía (ver `reprocesarDocumento` y el aprendizaje de
 * `reproceso-documentos-borra-datos`). Cuando a un tipo de documento se le suma un campo
 * —los compradores de la factura, 2026-09-24— los casos abiertos necesitan ESE campo y
 * nada más.
 *
 * Reglas:
 *  - solo se escriben los slugs pedidos;
 *  - un slug que el bloque ya trae (con valor, corregido a mano, o vacío de un intento
 *    anterior) NO se toca;
 *  - un slug que la extracción no pudo leer (valor nulo) se escribe igual, como nulo con
 *    `manual: true`: así el campo aparece en pantalla para llenarlo a mano, y la próxima
 *    corrida sabe que ya se intentó.
 */

import type { CampoResultado } from '@/lib/ai/extract-fields'

export type ResultadoCompletar = {
  campos: Record<string, CampoResultado>
  /** Los slugs que se agregaron. Vacío = no hay nada que escribir. */
  agregados: string[]
}

export function completarCampos(
  actuales: Record<string, CampoResultado> | null | undefined,
  extraidos: Record<string, CampoResultado>,
  slugs: string[],
): ResultadoCompletar {
  const campos: Record<string, CampoResultado> = { ...(actuales ?? {}) }
  const agregados: string[] = []
  for (const slug of slugs) {
    // Cualquier entrada previa gana: un valor, una corrección a mano o un intento que
    // salió vacío. Re-extraer encima es justo lo que este módulo existe para no hacer.
    if (campos[slug]) continue
    const nuevo = extraidos[slug] ?? { value: null, confidence: 0, manual: true }
    campos[slug] = nuevo
    agregados.push(slug)
  }
  return { campos, agregados }
}

/** ¿Al bloque le falta alguno de estos campos? (Todavía no se intentó extraerlos.) */
export function faltanCampos(actuales: Record<string, CampoResultado> | null | undefined, slugs: string[]): boolean {
  return slugs.some(s => !(actuales && s in actuales))
}
