/**
 * Avanzar un cruce que frena, con motivo, sin corregir el dato.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────────
 * Los cruces de la línea (`cruces.ts`) frenan el avance cuando dos datos del negocio se
 * contradicen. Hasta el 2026-10-05 la única salida era corregir el dato (o el override
 * de owner/admin, que se salta TODOS los gates de la etapa de una vez). Hay diferencias
 * que el equipo sabe manejables: Mauricio decidió que el sistema avise y que unas
 * personas autorizadas puedan avanzar ESE cruce dejando el motivo.
 *
 * ── La excepción ─────────────────────────────────────────────────────────────────
 * Vale para UN cruce, en UN negocio, con UN valor de los datos: la `huella` de la
 * contradicción (los valores que se contradicen, ver `cruces.ts`). Si alguien cambia
 * el dato y el cruce vuelve a fallar con otros valores, la huella cambia y vuelve a
 * frenar. Las demás reglas siguen frenando. No depende de la etapa: un cruce que frena
 * de la 9 a la 20 se avanza una vez, no en cada salida.
 *
 * Las excepciones viven en `negocio_cruces_avanzados`, que solo escribe el servidor
 * (service_role) después de validar el permiso: si vivieran en una tabla que la sesión
 * puede escribir, cualquiera se fabricaría la suya. El historial del negocio
 * (`activity_log`) lleva además la entrada que lee la gente.
 *
 * ── Quién ────────────────────────────────────────────────────────────────────────
 *   workspaces.config_extra.avanzar_cruces.staff_ids = ["<staff_id>", ...]
 *
 * Solo la lista: el rol no da este permiso (owner/admin ya tienen el override de todos
 * los gates). FAIL-CLOSED: lista ausente, vacía o mal formada = nadie. Fuente ÚNICA para
 * el guard del servidor y para la pantalla que decide si dibuja el botón.
 *
 * Módulo puro, sin IO.
 */

import type { Contradiccion } from './cruces'

/** El motivo tiene que ser al menos una frase. */
export const MOTIVO_AVANCE_MIN = 15
/** `activity_log.contenido` admite 280 caracteres y el motivo va entero ahí. */
export const MOTIVO_AVANCE_MAX = 280

/** Marca de `activity_log.campo_modificado` para la entrada del historial. */
export const CAMPO_CRUCE_AVANZADO = 'cruce_avanzado'

/** Los `staff_id` declarados en `config_extra.avanzar_cruces.staff_ids`. */
export function staffIdsQueAvanzanCruces(configExtraWorkspace: unknown): string[] {
  if (!configExtraWorkspace || typeof configExtraWorkspace !== 'object') return []
  const av = (configExtraWorkspace as { avanzar_cruces?: unknown }).avanzar_cruces
  if (!av || typeof av !== 'object') return []
  const ids = (av as { staff_ids?: unknown }).staff_ids
  if (!Array.isArray(ids)) return []
  return ids.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
}

/** `staffId` es `staff.id` (lo que guarda la lista), no `profile.id`. */
export function puedeAvanzarCruces(staffId: string | null | undefined, configExtraWorkspace: unknown): boolean {
  if (!staffId) return false
  return staffIdsQueAvanzanCruces(configExtraWorkspace).includes(staffId)
}

/** `null` si el motivo sirve; si no, el texto del error. */
export function validarMotivoAvance(motivo: unknown): string | null {
  const m = typeof motivo === 'string' ? motivo.trim() : ''
  if (m.length < MOTIVO_AVANCE_MIN) return `Escribe el motivo en una frase (mínimo ${MOTIVO_AVANCE_MIN} caracteres).`
  if (m.length > MOTIVO_AVANCE_MAX) return `El motivo no puede pasar de ${MOTIVO_AVANCE_MAX} caracteres.`
  return null
}

/** Una excepción guardada (fila de `negocio_cruces_avanzados`). */
export type AvanceCruce = {
  cruce_slug: string
  /** Hash de la huella (ver `hashHuella` en el servidor). */
  huella: string
  motivo: string
  autor: string | null
  created_at: string
}

/**
 * Marca las contradicciones que tienen una excepción con la MISMA huella. Si hay varias,
 * la más reciente. Una contradicción sin huella (un voto) no se marca nunca.
 */
export function aplicarAvances(contradicciones: Contradiccion[], avances: AvanceCruce[]): Contradiccion[] {
  if (avances.length === 0) return contradicciones
  return contradicciones.map(c => {
    if (!c.huella) return c
    const vigente = avances
      .filter(a => a.cruce_slug === c.slug && a.huella === c.huella)
      .sort((x, y) => (x.created_at < y.created_at ? 1 : -1))[0]
    if (!vigente) return c
    return { ...c, avanzado: { autor: vigente.autor, motivo: vigente.motivo, fecha: vigente.created_at } }
  })
}

/** ¿Esta contradicción se puede avanzar con motivo? (cruce de línea, no voto). */
export function esAvanzable(c: Contradiccion): boolean {
  return typeof c.huella === 'string' && c.huella !== ''
}

/** Lo que el modal de gates sabe de cada bloqueo (forma de `bloquesPendientes`). */
type BloqueModal = { nombre?: string; es_gate?: boolean; tipo?: string; cruce_slug?: string; advertencia?: string }

/**
 * Los slugs a avanzar si TODO lo que frena son cruces avanzables; si no, vacío. Con un
 * gate de otra clase pendiente, avanzar los cruces no destraba el caso: el botón no se
 * ofrece y la salida es la de siempre.
 */
export function crucesQueSeAvanzan(bloques: ReadonlyArray<BloqueModal>): string[] {
  if (bloques.length === 0) return []
  if (!bloques.every(b => b.tipo === 'cruce' && typeof b.cruce_slug === 'string' && b.cruce_slug)) return []
  return [...new Set(bloques.map(b => b.cruce_slug as string))]
}

/** Los textos de costo de los cruces, sin repetir (los 4 de antes de radicar dicen lo mismo). */
export function advertenciasDeCruces(bloques: ReadonlyArray<BloqueModal>): string[] {
  return [...new Set(bloques.map(b => b.advertencia?.trim() ?? '').filter(Boolean))]
}
