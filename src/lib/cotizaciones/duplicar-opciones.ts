/**
 * Duplicar una cotización que tiene opciones e itinerarios.
 *
 * ## Por qué esto vive aparte y con pruebas
 *
 * `items.opcion_de` es una **FK a la propia tabla**, y `itinerario_opciones.item_id`
 * apunta a los ítems. Al copiar, los ids cambian: si el remapeo se hace mal, la copia
 * queda apuntando a los ítems del ORIGINAL. Eso no falla —las filas existen— y el
 * síntoma es que editar la copia le mueve las combinaciones a la cotización de la que
 * salió. Es exactamente la familia de defectos que ya costó caro en esta misma
 * función: `margen_porcentaje ?? 0` convirtió «hereda» en «excepción al 0%» y la copia
 * entera salió vendida a costo.
 *
 * `duplicarCotizacion` es además la vía por la que un defecto de copia llega a
 * cotizaciones cerradas, así que el remapeo se prueba solo, sin base.
 */

/** Lo mínimo de un ítem original para saber a qué apunta. */
export interface ItemOriginal {
  id: string
  opcion_de?: string | null
}

/** Lo mínimo de un itinerario original para copiarlo. */
export interface ItinerarioOriginal {
  id: string
  nombre: string | null
  orden: number
  va_en_propuesta: boolean
  es_principal: boolean
  seleccion: string[]
  /**
   * El motivo de la combinación (§3.3). `undefined` = la base no tiene las columnas: no se
   * nombran en el insert, porque nombrarlas tumbaría la copia entera con un 42703.
   */
  motivo_codigo?: string | null
  motivo_texto?: string | null
}

/**
 * Qué `opcion_de` le toca a cada ítem NUEVO, traducido al mundo de la copia.
 *
 * Devuelve solo los que apuntan a alguien: un ítem titular no necesita un UPDATE.
 *
 * ⚠️ Un `opcion_de` que apunta a un ítem que NO se copió se traduce a `null`, no se
 * conserva. Dejar el id viejo haría que la copia colgara de un ítem de la cotización
 * original: el ítem quedaría vivo en la copia pero su ranura la decidiría otro
 * documento. Perder el vínculo es visible —la opción aparece como titular suelto— y
 * conservarlo mal no lo es.
 */
export function remapearOpcionDe(
  originales: ItemOriginal[],
  mapa: Map<string, string>,
): { nuevoId: string; opcionDe: string | null }[] {
  const patches: { nuevoId: string; opcionDe: string | null }[] = []
  for (const item of originales) {
    if (!item.opcion_de) continue
    const nuevoId = mapa.get(item.id)
    if (!nuevoId) continue
    patches.push({ nuevoId, opcionDe: mapa.get(item.opcion_de) ?? null })
  }
  return patches
}

/**
 * Los itinerarios de la copia, con su selección ya traducida.
 *
 * ⚠️ Un itinerario cuya selección quede **incompleta** porque alguno de sus ítems no
 * se copió se conserva igual, con lo que sí se pudo traducir. La regla R2 lo marcará
 * incompleto en pantalla y nadie podrá mandarlo al cliente, que es el desenlace
 * correcto: borrarlo en silencio le quitaría a alguien una combinación que armó.
 */
export function itinerariosParaLaCopia(
  originales: ItinerarioOriginal[],
  mapaItems: Map<string, string>,
  nuevaCotizacionId: string,
  workspaceId: string,
): { cabecera: Record<string, unknown>; seleccion: string[]; origenId: string }[] {
  return originales.map(orig => ({
    origenId: orig.id,
    cabecera: {
      workspace_id: workspaceId,
      cotizacion_id: nuevaCotizacionId,
      nombre: orig.nombre,
      orden: orig.orden,
      // ⚠️ La marca de propuesta SÍ se hereda, y el principal TAMBIÉN: duplicar es
      // corregir el mismo documento, y una copia que naciera con todo apagado
      // obligaría a rehacer la revisión de nueve combinaciones. El candado del piso
      // se vuelve a aplicar en el primer `recalcularTotales` de la copia, así que una
      // combinación que dejó de valer se desmarca sola y lo dice.
      va_en_propuesta: orig.va_en_propuesta,
      es_principal: orig.es_principal,
      // El motivo es parte de la tarifa: por qué se armó así sigue siendo cierto en la copia.
      ...(orig.motivo_codigo !== undefined ? { motivo_codigo: orig.motivo_codigo } : {}),
      ...(orig.motivo_texto !== undefined ? { motivo_texto: orig.motivo_texto } : {}),
    },
    seleccion: orig.seleccion
      .map(id => mapaItems.get(id))
      .filter((id): id is string => typeof id === 'string'),
  }))
}

// ── La copia COMPLETA (2026-09-22) ───────────────────────────────────────────

/**
 * Qué NO viaja de la cotización original. Todo lo demás se copia tal cual.
 *
 * ⚠️ Lista de EXCLUSIÓN y no de inclusión, a propósito: «duplicar copia todo». Una
 * columna nueva de la cotización (una condición comercial, un texto del documento) viaja
 * sola, sin que nadie tenga que acordarse de agregarla aquí. Hasta el 2026-09-22 cada
 * camino copiaba su propia lista, y el del bloque del negocio no copiaba ni los ítems.
 *
 * Fuera quedan: la identidad (id, consecutivo, código, fechas de la fila), el ESTADO (la
 * copia nace en borrador), lo que dejó el ENVÍO (fechas, correo) y la elección del cliente
 * al aprobar. Las excepciones de margen viven en otra tabla y no se copian: la copia
 * vuelve a medir su margen.
 */
export const COLUMNAS_QUE_NO_VIAJAN = [
  'id',
  'workspace_id',
  'consecutivo',
  'codigo',
  'estado',
  'created_at',
  'updated_at',
  'fecha_envio',
  'fecha_validez',
  'email_enviado_a',
  'duplicada_de',
  'tarifa_aceptada_id',
  // Embebidos de un `select` con relaciones: no son columnas.
  'oportunidades',
  'items',
] as const

/**
 * La fila de la cotización COPIA, lista para insertar.
 *
 * @param original La fila entera (`select('*')`).
 */
export function cotizacionParaLaCopia(
  original: Record<string, unknown>,
  args: { workspaceId: string; consecutivo: string; descripcion: string | null; originalId: string },
): Record<string, unknown> {
  const fuera = new Set<string>(COLUMNAS_QUE_NO_VIAJAN)
  const copia: Record<string, unknown> = {}
  for (const [col, valor] of Object.entries(original)) {
    if (fuera.has(col)) continue
    copia[col] = valor
  }
  return {
    ...copia,
    workspace_id: args.workspaceId,
    consecutivo: args.consecutivo,
    codigo: '',
    estado: 'borrador',
    descripcion: args.descripcion,
    duplicada_de: args.originalId,
    ...('documento_cliente' in original
      ? { documento_cliente: documentoClienteSinRevisar(original.documento_cliente) }
      : {}),
  }
}

/**
 * El texto del documento del cliente, de vuelta a BORRADOR.
 *
 * Se copia el texto (redactarlo otra vez cuesta y casi siempre sirve), pero no la
 * revisión: `revisado_en` es la firma de que alguien lo leyó para ESE documento, y la
 * copia existe justamente para cambiar algo. Con la firma copiada, el PDF de la copia
 * imprimiría un texto que nadie revisó contra lo que ahora dice.
 */
export function documentoClienteSinRevisar(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw ?? null
  return { ...(raw as Record<string, unknown>), revisado_en: null, revisado_por: null, revisado_por_nombre: null }
}

/**
 * La línea copia. Todo lo de la línea viaja —la tarifa por pasajero con sus casillas, su
 * confirmación y sus correcciones; la ranura; el día; la base del IVA; el margen tal cual
 * (`null` sigue siendo «usa el de la cotización», nunca 0)— salvo su identidad y el
 * vínculo `opcion_de`, que se repone en una segunda pasada (`remapearOpcionDe`): el
 * titular puede venir DESPUÉS de su opción.
 */
export function itemParaLaCopia(
  item: Record<string, unknown>,
  nuevaCotizacionId: string,
  /**
   * Ranura original → ranura copia (`copiarRanuras`). La ranura es de la COTIZACIÓN: la
   * copia no puede colgar de la de la original, que al renombrarse movería las dos. Sin
   * mapa, o con una ranura que no está en él, la línea copia nace sin ranura y la sigue
   * agrupando su `grupo`, que viaja intacto.
   */
  mapaRanuras?: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const {
    id: _id, cotizacion_id: _c, created_at: _ca, updated_at: _ua, rubros: _r, opcion_de: _o, ranura_id: ranuraId,
    ...resto
  } = item
  const ranuraCopia = typeof ranuraId === 'string' ? mapaRanuras?.get(ranuraId) : undefined
  return { ...resto, cotizacion_id: nuevaCotizacionId, ...(ranuraCopia ? { ranura_id: ranuraCopia } : {}) }
}

/**
 * El rubro copia, CONFIRMADO O SUGERIDO: la copia es el mismo documento y una sugerencia
 * pendiente sigue siendo la misma pregunta (su lectura viaja en `tarifa_pax.casillas`).
 * `valor_total` es GENERATED en la base y no se puede insertar.
 */
export function rubroParaLaCopia(rubro: Record<string, unknown>, nuevoItemId: string): Record<string, unknown> {
  const { id: _id, item_id: _i, valor_total: _v, created_at: _ca, updated_at: _ua, ...resto } = rubro
  return { ...resto, item_id: nuevoItemId }
}

/** El adicional copia, colgado de la VARIANTE copia (nunca de la original). */
export function adicionalParaLaCopia(fila: Record<string, unknown>, nuevoItemId: string): Record<string, unknown> {
  const { id: _id, item_id: _i, created_at: _ca, ...resto } = fila
  return { ...resto, item_id: nuevoItemId }
}
