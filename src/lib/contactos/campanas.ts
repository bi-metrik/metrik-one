/**
 * Atribución de campaña de un contacto — FUENTE ÚNICA de la regla.
 *
 * Responde las tres preguntas que la supervisora comercial hace sobre un lead:
 * cuál campaña lo trajo la PRIMERA vez, cuál fue la última, y cuántos
 * formularios llenó. La primera es la que se usa para atribuir un cierre, así
 * que dos pantallas que la calculen por su cuenta terminarían atribuyendo el
 * mismo cierre a campañas distintas.
 *
 * Consumidores (los tres importan de aquí; la regla no está escrita en ningún
 * otro sitio):
 *  - el panel lateral de `/negocios/[id]` (vía `getNegocioDetalle`, servidor)
 *  - `ResumenCampanas` en el 360 del contacto (`directorio/contacto/[id]`), que
 *    consume `resumenCampanasContacto` tal cual y solo pone la presentación
 *  - la vista general del directorio (`getContactos` + `contactos-list.tsx`),
 *    por la vía reducida de la segunda mitad de este archivo
 *
 * Los tres tienen que seguir dando lo mismo para el mismo contacto: la primera
 * campaña del 360 y la del panel de su negocio son el mismo dato, y el día que
 * discrepen dos pantallas le adjudican el mismo cierre a campañas distintas.
 *
 * La regla, textual:
 *  - La PRIMERA sale de `custom_data.origen` del contacto, no del `min()` de
 *    las interacciones: ese campo es first-touch inmutable grabado por el
 *    webhook. Solo cuando el contacto no lo tiene (leads previos al webhook) se
 *    cae a la interacción más vieja que declare campaña.
 *  - Nombre y fecha salen SIEMPRE de la misma fuente. Medido el 2026-09-02: 333
 *    contactos del workspace SOENA tienen `origen.first_at` con
 *    `origen.campaign_name` en null (la llave existe, el valor no). Tomar el
 *    nombre de la interacción más vieja y la fecha de `origen` mezclaría dos
 *    orígenes y podría fechar mal la primera campaña.
 *  - Sin primera campaña no hay resumen: devuelve null y la pantalla no pinta
 *    el bloque.
 */

/** Origen (primer toque) grabado por el webhook en `contactos.custom_data.origen`. */
export type OrigenCampana = {
  campaign_name?: string | null
  first_at?: string | null
}

/** Lo mínimo que hace falta de una fila de `contacto_interacciones`. */
export type InteraccionCampana = {
  payload: Record<string, unknown> | null
  ocurrida_at: string | null
  created_at: string | null
}

export type ResumenCampanas = {
  /** Interacciones que declaran campaña. Es el "N formularios" de la pantalla. */
  formularios: number
  primeraNombre: string
  primeraFecha: string | null
  /** null cuando la más nueva no declara campaña. */
  ultimaNombre: string | null
  ultimaFecha: string | null
  /** Con un solo formulario, primera y última son la misma fila: se colapsa. */
  hayVarias: boolean
}

/**
 * Lee un texto del payload de la interacción. El payload de Meta trae
 * `campaign_name` y `ad_name` en las 703 de 703 interacciones medidas, pero el
 * tipo es `Record<string, unknown>`: se lee defensivo y sin placeholder.
 */
export function textoPayload(it: InteraccionCampana, key: string): string | null {
  const v = it.payload?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Espeja el orden con el que `getInteraccionesPorContacto` sirve las filas
 * (`ocurrida_at desc nulls last`, luego `created_at desc`). El resumen depende
 * del orden, así que ordenar aquí es lo que hace que el servidor y el 360 del
 * contacto lleguen al mismo resultado sin que quien llama tenga que acordarse.
 * Sobre una lista ya ordenada por la base no cambia nada.
 */
export function ordenarRecientesPrimero(interacciones: InteraccionCampana[]): InteraccionCampana[] {
  const cmpDesc = (a: string | null, b: string | null): number => {
    // nulls al final, como `nullsFirst: false` de PostgREST.
    if (a === b) return 0
    if (a === null) return 1
    if (b === null) return -1
    return a < b ? 1 : -1
  }
  return [...interacciones].sort(
    (x, y) => cmpDesc(x.ocurrida_at, y.ocurrida_at) || cmpDesc(x.created_at, y.created_at),
  )
}

export function resumenCampanasContacto(
  interacciones: InteraccionCampana[],
  origen: OrigenCampana | null | undefined,
): ResumenCampanas | null {
  const ordenadas = ordenarRecientesPrimero(interacciones)
  const conCampana = ordenadas.filter((it) => textoPayload(it, 'campaign_name') !== null)
  const masNueva = conCampana[0] ?? null
  const masVieja = conCampana[conCampana.length - 1] ?? null

  const origenNombre = origen?.campaign_name?.trim() || null
  const primeraNombre = origenNombre ?? (masVieja ? textoPayload(masVieja, 'campaign_name') : null)
  if (!primeraNombre) return null

  const primeraFecha = origenNombre
    ? origen?.first_at ?? null
    : masVieja?.ocurrida_at ?? masVieja?.created_at ?? null

  const ultimaNombre = masNueva ? textoPayload(masNueva, 'campaign_name') : null
  const ultimaFecha = masNueva?.ocurrida_at ?? masNueva?.created_at ?? null

  return {
    formularios: conCampana.length,
    primeraNombre,
    primeraFecha,
    ultimaNombre,
    ultimaFecha,
    hayVarias: conCampana.length > 1 && ultimaNombre !== null,
  }
}

// ============================================================
// La misma atribución, sobre la lista YA REDUCIDA de la vista general
// ============================================================
// `resumenCampanasContacto` (arriba) trabaja sobre las filas de
// `contacto_interacciones` porque el 360 y el panel lateral las tienen a mano. La
// vista general de `/directorio/contactos` no: `getContactos` reduce las 703
// interacciones del workspace a `ContactoConMeta.campanas` —nombres, sin repetir,
// de la más vieja a la más nueva— para no mandarle 703 payloads al navegador.
//
// Las funciones de abajo responden lo mismo sobre esa forma reducida, y viven en
// ESTE archivo justamente para que la regla no se escriba dos veces: la primera
// campaña sale de `custom_data.origen` en las dos, porque es con ella que se
// atribuye un cierre. Dos pantallas que atribuyan distinto le adjudican el mismo
// cierre a campañas diferentes.

// ── Reducción: de filas de `contacto_interacciones` a `campanas[]` ──────────
//
// Vive aquí, y no dentro de `getContactos`, para poder probarse con las filas
// reales de producción sin levantar Supabase. La forma es un acumulador porque
// el servidor recorre TODAS las interacciones del workspace una sola vez y
// reparte cada fila en el contacto que le toca.

/**
 * Suma una interacción de Meta al acumulador de campañas de un contacto.
 *
 * La clave del `Map` deduplica (dos formularios de la misma campaña son DOS
 * interacciones y UNA campaña) y el valor guarda la PRIMERA vez que se vio, que
 * es lo que después ordena.
 *
 * ⚠️ Una interacción sin ninguna de las dos fechas se ancla en `''` para que
 * ordene como la más vieja: es lo único que se sabe de ella, y dejarla sin marca
 * la mandaría al final, donde afirmaría ser la campaña más reciente sin un dato
 * que lo sostenga. Medido: 0 filas así en SOENA hoy.
 */
export function acumularCampana(
  acumulado: Map<string, string>,
  payload: Record<string, unknown> | null,
  cuando: string | null,
): void {
  const campana = typeof payload?.campaign_name === 'string' ? payload.campaign_name.trim() : ''
  if (!campana) return
  const vista = acumulado.get(campana)
  const marca = cuando ?? ''
  if (vista === undefined || marca < vista) acumulado.set(campana, marca)
}

/**
 * Campañas de un contacto, de la más vieja a la más nueva y sin repetir.
 *
 * El orden es por la PRIMERA vez que se vio cada campaña, no por la última: la
 * pregunta que responde es cuál lo trajo primero, y una campaña vieja que vuelve
 * a aparecer no deja de ser la primera.
 */
export function ordenarCampanas(acumulado: Map<string, string> | undefined): string[] {
  if (!acumulado || acumulado.size === 0) return []
  return [...acumulado.entries()]
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([nombre]) => nombre)
}

/** Lo mínimo que hace falta de un contacto ya reducido para atribuirle campaña. */
export type ContactoCampanas = {
  /** De la más vieja a la más nueva, sin repetir. */
  campanas: string[]
  origen?: { campaign_name?: string | null } | null
}

export type AtribucionCampanas = {
  /** Con la que se atribuye el cierre. `null` si el contacto no tiene ninguna. */
  primera: string | null
  /**
   * La más reciente, SOLO cuando aporta algo distinto de `primera`.
   *
   * `null` cuando el contacto tiene una sola campaña (605 de 651 con Meta en
   * SOENA): repetir el mismo texto en dos columnas gasta el ancho que necesitan
   * los nombres, que llegan a 34 caracteres.
   */
  ultima: string | null
}

/**
 * Primera y última campaña de un contacto. **Manda `custom_data.origen`**, que es
 * el primer toque inmutable; `campanas[0]` solo entra cuando el contacto no lo
 * tiene (leads anteriores al webhook).
 *
 * ⚠️ Los dos pueden discrepar, y entonces la fila muestra una campaña menos de
 * las que el contacto tocó. Medido en SOENA el 2026-09-02: **1 contacto de 988**
 * (su `origen` dice "CAMPAÑA SEP DANIELA" y sus interacciones van "CLIENTES
 * POTENCIALES AGO ($50)" → "CAMPAÑA SEP DANIELA", así que primera y última
 * coinciden y la columna de última queda vacía). No se corrige tomando
 * `campanas[0]`: eso cambiaría la fuente de la atribución. La columna de
 * formularios sigue delatando que hubo más de un toque y el 360 del contacto
 * muestra el historial completo.
 */
export function atribucionDesdeCampanas(contacto: ContactoCampanas): AtribucionCampanas {
  const origenNombre = contacto.origen?.campaign_name?.trim() || null
  const primera = origenNombre ?? contacto.campanas[0] ?? null
  const masNueva = contacto.campanas[contacto.campanas.length - 1] ?? null
  return { primera, ultima: masNueva && masNueva !== primera ? masNueva : null }
}

/**
 * Todas las campañas a las que pertenece un contacto, para filtrar.
 *
 * Une las de sus interacciones con la de `origen`. Hoy la unión no agrega a nadie
 * —medido: 0 de 988 contactos tienen un `origen.campaign_name` que no esté
 * también entre sus interacciones, y el filtro da el mismo conteo con y sin
 * ella— pero el `origen` sobrevive a que las interacciones se muevan (fusión de
 * duplicados, conversión, descarte), y un contacto que llegó por una campaña no
 * puede desaparecer al filtrar justo por ella.
 */
export function campanasParaFiltrar(contacto: ContactoCampanas): string[] {
  const origenNombre = contacto.origen?.campaign_name?.trim() || null
  if (!origenNombre || contacto.campanas.includes(origenNombre)) return contacto.campanas
  return [...contacto.campanas, origenNombre]
}

/** Valor del filtro que no filtra nada. */
export const CAMPANA_TODAS = '__todas__'
/**
 * Contactos que tocaron más de una campaña distinta (44 en SOENA hoy). Es el caso
 * que la supervisora comercial no tenía cómo listar: un mismo número respondiendo
 * dos pautas es un lead que ya se calentó dos veces, no dos leads.
 */
export const CAMPANA_VARIAS = '__varias__'

/** ¿Este contacto pasa el filtro de campaña? */
export function contactoEnCampana(contacto: ContactoCampanas, seleccion: string): boolean {
  if (seleccion === CAMPANA_TODAS) return true
  const suyas = campanasParaFiltrar(contacto)
  if (seleccion === CAMPANA_VARIAS) return suyas.length > 1
  return suyas.includes(seleccion)
}

export type OpcionCampana = { value: string; label: string; count: number }

/**
 * Opciones del selector, derivadas de los datos y no de una lista escrita a mano:
 * cuando Meta lance otra campaña tiene que aparecer sola.
 *
 * Dos reglas que no son obvias:
 *
 *  - Los conteos se calculan sobre TODOS los contactos, nunca sobre la lista ya
 *    filtrada. Un contador que se filtra a sí mismo manda a cero a las demás
 *    opciones en cuanto se elige una, y entonces el selector deja de servir para
 *    saltar de campaña (el mismo defecto que ya mordió en los chips de
 *    `/negocios`, PR #191).
 *  - `seleccionada` se agrega aunque no exista en los datos (enlace viejo,
 *    campaña cuyos contactos se fusionaron). Un `<select>` no puede mostrar un
 *    valor que no es opción suya: el filtro seguiría recortando la lista y no
 *    habría forma de quitarlo, que es la peor combinación posible.
 */
export function opcionesDeCampana(
  contactos: ContactoCampanas[],
  seleccionada: string,
): OpcionCampana[] {
  const cuenta = new Map<string, number>()
  for (const c of contactos) {
    // `new Set` para que un dato repetido no infle el contador de una campaña:
    // lo que se cuenta son CONTACTOS, no formularios.
    for (const campana of new Set(campanasParaFiltrar(c))) {
      cuenta.set(campana, (cuenta.get(campana) ?? 0) + 1)
    }
  }
  const opciones = [...cuenta.entries()]
    // Por volumen: la campaña con más gente es la que más se consulta. Desempate
    // alfabético para que el orden no baile entre cargas con conteos iguales.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    .map(([value, count]) => ({ value, label: value, count }))

  if (
    seleccionada !== CAMPANA_TODAS &&
    seleccionada !== CAMPANA_VARIAS &&
    !cuenta.has(seleccionada)
  ) {
    opciones.push({ value: seleccionada, label: seleccionada, count: 0 })
  }
  return opciones
}

/** Cuántos contactos tocaron más de una campaña. Alimenta la etiqueta de la opción. */
export function contarVariasCampanas(contactos: ContactoCampanas[]): number {
  return contactos.filter((c) => campanasParaFiltrar(c).length > 1).length
}
