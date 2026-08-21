/**
 * Indexa los campos que la tarjeta de /negocios lee de los bloques.
 *
 * Un mismo bloque (RUT, Factura, Radicado) existe varias veces por negocio: la
 * instancia de origen trae el dato y las de las etapas siguientes son copias
 * readonly que suelen llegar vacias. La regla, que ya existia antes de mover la
 * extraccion a Postgres, es **la primera con valor gana**.
 *
 * Vive aparte de `negocio-v2-actions` porque es la parte que se puede probar y
 * la que se puede equivocar en silencio: si el indice se queda con la copia
 * vacia, la tarjeta pierde la cedula y la busqueda por cedula deja de encontrar
 * el negocio, sin ningun error visible.
 */

/** Fila tal como la devuelve la funcion `negocio_bloques_campos`. */
export type FilaCampo = {
  negocio_id: string
  bloque_nombre: string
  campo: string
  valor: string
}

/** negocio → bloque → campo → valor. */
export type IndiceCampos = Record<string, Record<string, Record<string, string>>>

export function indexarCamposDeBloques(filas: readonly FilaCampo[]): IndiceCampos {
  const indice: IndiceCampos = {}
  for (const f of filas) {
    if (!f?.negocio_id || !f.bloque_nombre || !f.campo) continue
    const valor = (f.valor ?? '').trim()
    if (!valor) continue
    const porBloque = (indice[f.negocio_id] ??= {})
    const porCampo = (porBloque[f.bloque_nombre] ??= {})
    // `??=`: la primera instancia con valor se queda; las copias no la pisan.
    porCampo[f.campo] ??= valor
  }
  return indice
}

/**
 * Lee un campo del indice. Devuelve null cuando el workspace no configuro ese
 * bloque o ese campo — que es el caso de todos los workspaces menos SOENA.
 */
export function leerCampo(
  indice: IndiceCampos,
  negocioId: string,
  bloque: string | undefined,
  campo: string | undefined,
): string | null {
  if (!bloque || !campo) return null
  return indice[negocioId]?.[bloque]?.[campo] ?? null
}
