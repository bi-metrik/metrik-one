/**
 * Indexa los campos que la tarjeta de /negocios lee de los bloques.
 *
 * Un mismo bloque (RUT, Factura, Radicado) existe varias veces por negocio: la
 * instancia de origen trae el dato y las de las etapas siguientes son copias
 * readonly que suelen llegar vacias. La regla es **la primera con valor gana**,
 * y desde `negocio_bloques_campos_json` el desempate lo resuelve Postgres por
 * `created_at`: antes dependia del orden en que llegaran las filas, que no
 * estaba garantizado y hacia que un negocio con dos copias distintas mostrara
 * hoy una y manana la otra.
 *
 * Vive aparte de `negocio-v2-actions` porque es la parte que se puede probar y
 * la que se puede equivocar en silencio: si el indice se queda con la copia
 * vacia, la tarjeta pierde la cedula y la busqueda por cedula deja de encontrar
 * el negocio, sin ningun error visible.
 */

/** negocio → bloque → campo → valor. */
export type IndiceCampos = Record<string, Record<string, Record<string, string>>>

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

// ── Lectura sin truncar: una fila por negocio ────────────────────────────────
//
// `negocio_bloques_campos` devolvia una fila por (negocio, bloque, campo) y con
// pocos cientos de negocios eso pasa de las tres mil filas en una respuesta. La
// respuesta se corta antes del final y los campos que el plan devuelve de ultimo
// desaparecen sin ningun error: fue asi como el filtro de servicio contratado
// llego a mostrar 3 casos donde habia 75. `negocio_bloques_campos_json` devuelve
// una sola fila por negocio con todo adentro, y el desempate entre copias del
// mismo bloque ya viene resuelto desde Postgres.

/** Par (bloque, campo) que se le pide a `negocio_bloques_campos_json`. */
export type ParCampo = { bloque: string; campo: string }

/** Fila tal como la devuelve `negocio_bloques_campos_json`. */
export type FilaValores = {
  negocio_id: string
  /** { "RUT": { "numero_identificacion": "79876543" }, ... } */
  valores: Record<string, Record<string, string>> | null
}

/**
 * Arma la lista de pares a pedir, sin duplicados y sin pares incompletos.
 *
 * Se piden PARES y no el producto de todos los bloques por todos los campos:
 * pedir "numero_factura" contra los cinco bloques traia combinaciones que nadie
 * lee (el numero de factura guardado en el bloque RUT) y multiplicaba el tamano
 * de la respuesta, que es justo lo que rompia la lectura.
 */
export function paresDeCampos(
  entradas: ReadonlyArray<{ bloque: string | undefined; campos: ReadonlyArray<string | undefined> }>,
): ParCampo[] {
  const vistos = new Set<string>()
  const pares: ParCampo[] = []
  for (const e of entradas) {
    if (!e.bloque) continue
    for (const campo of e.campos) {
      if (!campo) continue
      const clave = `${e.bloque}\u0000${campo}`
      if (vistos.has(clave)) continue
      vistos.add(clave)
      pares.push({ bloque: e.bloque, campo })
    }
  }
  return pares
}

/** Convierte las filas de `negocio_bloques_campos_json` al mismo indice de siempre. */
export function indexarValoresDeBloques(filas: readonly FilaValores[]): IndiceCampos {
  const indice: IndiceCampos = {}
  for (const f of filas) {
    if (!f?.negocio_id || !f.valores) continue
    const porBloque = (indice[f.negocio_id] ??= {})
    for (const [bloque, campos] of Object.entries(f.valores)) {
      if (!bloque || !campos) continue
      const porCampo = (porBloque[bloque] ??= {})
      for (const [campo, valor] of Object.entries(campos)) {
        const v = (valor ?? '').trim()
        if (!campo || !v) continue
        porCampo[campo] ??= v
      }
    }
  }
  return indice
}
