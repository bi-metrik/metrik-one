/**
 * Devolución de un bloque a su área de origen: las REGLAS, en un solo sitio.
 *
 * El caso que lo obliga (SOENA VE): operaciones recibe un documento que comercial cargó
 * mal — ilegible, vencido, el archivo equivocado — y tiene que hacerlo corregir. Hoy eso
 * ocurre por WhatsApp y no deja rastro. Medido en producción el 2026-08-21: de 1.019
 * movimientos de etapa registrados, solo **3 casos** volvieron de operaciones a comercial,
 * y **ninguna** devolución guarda motivo. La conclusión no es que no pase: es que pasa
 * fuera de la plataforma, así que no se puede contar ni mejorar.
 *
 * ── Tres decisiones de diseño ───────────────────────────────────────────────────────
 *
 * 1. **Se devuelve el BLOQUE, y con él vuelve el CASO a manos de quien lo cargó.** La
 *    primera versión dejaba el caso quieto en operaciones para no borrarle el avance. En
 *    la práctica eso no resolvía el dolor: el documento quedaba pendiente pero el caso
 *    seguía apareciendo en la bandeja de operaciones, así que el trabajo de perseguir al
 *    cliente seguía siendo de operaciones. El caso vuelve a la etapa donde vive el bloque
 *    ORIGINAL, que en los tres bloques habilitados hoy es una etapa de venta.
 *
 *    El avance NO se borra: los bloques ya diligenciados de las etapas de ejecución se
 *    quedan como están, y el caso los vuelve a encontrar completos al avanzar. Devolver
 *    mueve el dueño, no la memoria.
 *
 * 2. **Esto NO es un reproceso** (`reproceso-actions.ts`). Un reproceso existe porque un
 *    TERCERO rechazó el trabajo (la UPME emite un certificado malo, la DIAN devuelve la
 *    solicitud) y rehace un tramo entero del flujo. Aquí nadie rechazó nada: el dato entró
 *    mal desde adentro. Fundirlos contaminaría el indicador de calidad que pesa en el bono
 *    de operaciones, que solo debe contar fallas frente a terceros.
 *
 * 3. **El motivo es una lista cerrada, no texto libre.** Un motivo escrito a mano no se
 *    puede agrupar, y sin agrupar no hay indicador: el frente entero existe para poder
 *    responder "qué documento se devuelve más y por qué". La nota libre queda como
 *    complemento, nunca como sustituto.
 */

/** Motivos por los que un bloque vuelve a su área de origen. Lista cerrada a propósito. */
export type MotivoDevolucion =
  | 'ilegible'
  | 'no_coincide'
  | 'vencido'
  | 'archivo_equivocado'
  | 'incompleto'

export const MOTIVOS_DEVOLUCION: readonly MotivoDevolucion[] = [
  'ilegible',
  'no_coincide',
  'vencido',
  'archivo_equivocado',
  'incompleto',
] as const

/**
 * Texto que ve el operador. Se redacta desde el problema, no desde la categoría: quien
 * devuelve está mirando el documento, no un diccionario de motivos.
 */
export const LABEL_MOTIVO: Record<MotivoDevolucion, string> = {
  ilegible: 'No se puede leer',
  no_coincide: 'El dato no coincide con el RUT o la factura',
  vencido: 'Está fuera de vigencia',
  archivo_equivocado: 'Es un documento distinto al que se pide',
  incompleto: 'Está incompleto (faltan páginas o la firma)',
}

export function esMotivoValido(v: unknown): v is MotivoDevolucion {
  return typeof v === 'string' && (MOTIVOS_DEVOLUCION as readonly string[]).includes(v)
}

/**
 * La marca que queda dentro de `negocio_bloques.data._devolucion` mientras la corrección
 * está pendiente.
 *
 * Vive en `data` y no en una columna nueva por la misma razón que `_cross_check` y
 * `_ciclos`: es estado de UN bloque, se lee siempre junto con el bloque, y meterlo en el
 * `estado` de la tabla obligaría a tocar un CHECK que comparten todos los workspaces.
 *
 * ⚠️ Esta marca NO es el insumo del indicador. Solo conserva la devolución VIGENTE: al
 * corregir se borra. Cada devolución se asienta además como hecho propio en
 * `devolucion_eventos`, igual que `reproceso_eventos` hace con los ciclos de reproceso.
 * Contar sobre la marca daría siempre "las que están abiertas hoy", que no es la pregunta.
 */
export type MarcaDevolucion = {
  motivo: MotivoDevolucion
  nota: string | null
  /** `staff.id` de quien devolvió. Null si no se pudo resolver. */
  por: string | null
  por_nombre: string | null
  /** Etapa donde estaba el caso al devolver. Contexto para quien corrige. */
  etapa: string | null
  en: string
  /** Fila de `devolucion_eventos`, para poder cerrarla al corregir. */
  evento_id: string | null
}

/** ¿Este bloque admite devolución? Lo declara la configuración, nunca el código. */
export function devolucionHabilitada(configExtra: Record<string, unknown> | null | undefined): boolean {
  return (configExtra ?? {}).devolucion_habilitada === true
}

/**
 * Lee la marca vigente de `data`. Devuelve null ante cualquier forma que no sea una marca
 * bien escrita: pintar un banner de "devuelto" sobre un objeto a medias le diría al
 * comercial que corrija algo que nadie devolvió.
 */
export function leerDevolucion(
  data: Record<string, unknown> | null | undefined,
): MarcaDevolucion | null {
  const cruda = (data ?? {})._devolucion
  if (!cruda || typeof cruda !== 'object' || Array.isArray(cruda)) return null
  const d = cruda as Record<string, unknown>
  if (!esMotivoValido(d.motivo)) return null
  if (typeof d.en !== 'string' || d.en.length === 0) return null
  return {
    motivo: d.motivo,
    nota: typeof d.nota === 'string' && d.nota.length > 0 ? d.nota : null,
    por: typeof d.por === 'string' ? d.por : null,
    por_nombre: typeof d.por_nombre === 'string' ? d.por_nombre : null,
    etapa: typeof d.etapa === 'string' ? d.etapa : null,
    en: d.en,
    evento_id: typeof d.evento_id === 'string' ? d.evento_id : null,
  }
}

/**
 * Quita la marca al corregir, devolviendo un objeto nuevo.
 *
 * No muta el `data` recibido: en `procesarDocumento` ese mismo objeto se sigue usando para
 * el update, y mutarlo dejaría el borrado dependiendo del orden de las líneas.
 */
export function limpiarDevolucion(
  data: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const copia = { ...(data ?? {}) }
  delete copia._devolucion
  return copia
}

/**
 * ¿Esta persona puede devolver un bloque de este caso?
 *
 * ⚠️ Devolver NO es editar, y por eso no se reusa `guardEditarBloque`: ese guard resuelve
 * el área por el stage del BLOQUE, así que dejaría por fuera justo a quien detecta el
 * error — operaciones mirando un documento que es de comercial. La regla aquí es más
 * simple y más ancha: quien trabaja el caso, o quien supervisa.
 *
 * **Fuente única, consumida por el guard del servidor Y por la pantalla.** Escrita dos
 * veces se desincronizan, y el síntoma es el peor de esta familia: la pantalla ofrece un
 * botón que el servidor rechaza. Es el mismo criterio de `puedeAutorizarCierreNoFacturable`.
 */
export function puedeDevolverBloque(
  role: string | null | undefined,
  esResponsable: boolean | null | undefined,
): boolean {
  if (role === 'owner' || role === 'admin' || role === 'supervisor') return true
  return esResponsable === true
}

/**
 * Slug del bloque ORIGINAL cuando esta config es una copia heredada de solo lectura.
 *
 * ⚠️ La copia heredada tiene fila propia en `negocio_bloques`, pero solo su `data` se
 * intercambia por la del origen al pintarla. Devolver sobre la fila de la copia reabriría
 * una casilla que nadie mira: quien corrige sube el documento en la etapa del origen. Por
 * eso la devolución se redirige al origen antes de tocar nada, igual que
 * `casilla-compartida` redirige la escritura.
 *
 * Exige las dos mitades (`readonly` Y el slug) por la misma razón que `origenCompartido`:
 * un flag sin slug no dice a dónde redirigir, y adivinar el destino de una devolución la
 * dejaría cayendo en la casilla equivocada sin que nadie se entere.
 */
export function origenDeCopiaHeredada(
  configExtra: Record<string, unknown> | null | undefined,
): string | null {
  const ce = configExtra ?? {}
  if (ce.readonly !== true) return null
  const slug = ce.source_bloque_slug
  return typeof slug === 'string' && slug.length > 0 ? slug : null
}

/**
 * ¿Hay que mover el caso hacia atrás, o ya está en la etapa del origen (o antes)?
 *
 * ⚠️ Se compara por `etapas_negocio.numero`, NUNCA por `orden`. En SOENA VE las dos
 * columnas divergen: Anexos es `numero` 15 pero `orden` 18, y Generación es `numero` 16
 * pero `orden` 13. Comparar por `orden` diría que Generación va ANTES de Anexos y la
 * devolución desde Generación no movería nada — que es justo el caso que existe para
 * resolver. `numero` es la secuencia que el equipo ve en pantalla y la única que ordena
 * el flujo real.
 *
 * Si el caso ya está en la etapa del origen o más atrás, no se mueve: solo se reabre la
 * casilla. Empujarlo hacia adelante para "llevarlo al origen" sería avanzar un caso por
 * una corrección, que es lo contrario de lo que se pidió.
 */
export function debeMoverElCaso(
  numeroEtapaActual: number | null | undefined,
  numeroEtapaOrigen: number | null | undefined,
): boolean {
  if (typeof numeroEtapaActual !== 'number' || typeof numeroEtapaOrigen !== 'number') return false
  return numeroEtapaActual > numeroEtapaOrigen
}
