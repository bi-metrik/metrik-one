/**
 * Prerrequisitos de un bloque: qué OTROS bloques deben estar respondidos antes de
 * poder generar algo con este.
 *
 * `config_extra.requiere_bloques` ya existía para los formularios (la carta de
 * autorización necesita los dos RUT cargados, porque nombra e identifica a ambos
 * comparecientes). La regla se extrae aquí porque la propuesta económica necesita
 * exactamente lo mismo con un bloque de DATOS, no de documento: no puede emitirse
 * sin saber qué contrató el cliente, porque el servicio decide si la tarifa UPME
 * entra al documento y en qué términos.
 *
 * ⚠️ Por qué la comprobación no podía copiarse tal cual: la del formulario da por
 * presente un bloque cuando tiene `drive_url` o `campos` — el vocabulario de un
 * documento. Un bloque de datos responde en `data.<campo>` y no tiene ninguno de
 * los dos, así que con ese criterio "Servicio contratado" saldría faltante incluso
 * respondido. Aquí las dos formas de responder cuentan.
 */

/** Un bloque exigido, tal como se declara en `config_extra.requiere_bloques`. */
export interface RequisitoBloque {
  slug: string
  /** Nombre para el mensaje de error. Cae al slug si no se declara. */
  label?: string
}

/** Claves que NO son una respuesta: las escribe el motor, no la persona. */
const CLAVES_DE_SISTEMA = new Set([
  'campos', 'campos_override', 'drive_url', 'storage_path', 'url',
  'completado_por', 'completado_at', 'manual',
])

/**
 * ¿Este bloque tiene respuesta?
 *
 * Cuenta como respondido si trae archivo (documento), campos extraídos por IA, o
 * cualquier campo de datos con valor. Un `data` vacío, o solo con las claves que
 * escribe el motor, significa que nadie lo ha contestado todavía.
 */
export function bloqueTieneRespuesta(data: Record<string, unknown> | null | undefined): boolean {
  if (!data || typeof data !== 'object') return false
  if (data.drive_url || data.storage_path || data.url) return true
  const campos = data.campos as Record<string, unknown> | undefined
  if (campos && Object.keys(campos).length > 0) return true
  return Object.entries(data).some(([k, v]) => {
    if (CLAVES_DE_SISTEMA.has(k)) return false
    return v !== null && v !== undefined && v !== '' && v !== false
  })
}

/**
 * De los requisitos declarados, cuáles siguen sin responder.
 *
 * `presentes` es el `data` de cada instancia encontrada, indexado por slug. Un slug
 * que no aparece en el mapa cuenta como faltante: el bloque puede existir en la
 * línea y no estar sembrado todavía en ESTE negocio, y en ese caso tampoco hay
 * respuesta.
 */
export function faltanRequisitos(
  requiere: RequisitoBloque[] | null | undefined,
  presentes: Map<string, Record<string, unknown> | null>,
): RequisitoBloque[] {
  if (!Array.isArray(requiere) || requiere.length === 0) return []
  return requiere.filter(r => !bloqueTieneRespuesta(presentes.get(r.slug) ?? null))
}

/** Nombres legibles de los requisitos que faltan, para el mensaje al operador. */
export function nombresDeRequisitos(faltantes: RequisitoBloque[]): string {
  return faltantes.map(f => f.label ?? f.slug).join(', ')
}
