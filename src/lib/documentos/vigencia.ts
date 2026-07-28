/**
 * Vigencia de documentos con fecha de caducidad.
 *
 * Un documento no se valida contra el día en que se carga sino contra el día en que
 * se va a usar. El caso que originó esto: un certificado bancario del 17 de julio
 * servía para una cita de comienzos de agosto y no para una de la tercera semana,
 * y el equipo lo descubría cuando la DIAN ya había rechazado el trámite.
 *
 * Módulo puro y sin dependencias: `documento-actions` es `'use server'` y no puede
 * exportar helpers sincrónicos, así que la lógica vive aquí para poder probarla.
 */

/** Fecha ISO (YYYY-MM-DD) a timestamp UTC de medianoche. Null si no parsea. */
export function parseFechaISO(v: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '').trim())
  if (!m) return null
  const anio = Number(m[1])
  const mes = Number(m[2])
  const dia = Number(m[3])
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  const t = Date.UTC(anio, mes - 1, dia)
  // Rechaza fechas imposibles que Date.UTC normaliza en silencio (31 de febrero).
  const d = new Date(t)
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  return t
}

export const VIGENCIA_DIAS_DEFAULT = 30

/**
 * ¿El documento expedido en `expedicion` sigue vigente el día `objetivo`?
 *
 * Devuelve null cuando falta alguna de las dos fechas o no parsean: sin datos no se
 * afirma que algo esté vencido, para no bloquear un trámite por una fecha ilegible.
 */
export function documentoVigenteEn(
  expedicion: unknown,
  objetivo: unknown,
  vigenciaDias: number = VIGENCIA_DIAS_DEFAULT,
): boolean | null {
  const tExp = parseFechaISO(expedicion)
  const tObj = parseFechaISO(objetivo)
  if (tExp === null || tObj === null) return null
  const dias = Math.round((tObj - tExp) / 86_400_000)
  // Un documento expedido DESPUÉS de la fecha objetivo también sirve: es más nuevo.
  return dias <= vigenciaDias
}

/** Días que tendrá el documento el día objetivo. Null si falta alguna fecha. */
export function diasAlObjetivo(expedicion: unknown, objetivo: unknown): number | null {
  const tExp = parseFechaISO(expedicion)
  const tObj = parseFechaISO(objetivo)
  if (tExp === null || tObj === null) return null
  return Math.round((tObj - tExp) / 86_400_000)
}
