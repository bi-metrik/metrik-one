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

const DIA_MS = 86_400_000

/** Timestamp UTC de medianoche a 'YYYY-MM-DD'. */
function isoDeTimestamp(t: number): string {
  const d = new Date(t)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${mm}-${dd}`
}

export const VIGENCIA_DIAS_DEFAULT = 30

/**
 * ¿El documento expedido en `expedicion` sigue vigente el día `objetivo`?
 *
 * Devuelve null cuando falta alguna de las dos fechas o no parsean: sin datos no se
 * afirma que algo esté vencido, para no bloquear un trámite por una fecha ilegible.
 *
 * ⚠️ `null` NO es lo mismo que `true`. Quien consuma esta función tiene que decidir
 * a propósito qué hace con "no se pudo comprobar" — tratarlo como aprobado es el
 * defecto que dejó 87 certificados vencidos pasando sin que nadie los mirara.
 * Para eso está `estadoVigencia`, que distingue los cuatro casos.
 */
export function documentoVigenteEn(
  expedicion: unknown,
  objetivo: unknown,
  vigenciaDias: number = VIGENCIA_DIAS_DEFAULT,
): boolean | null {
  const tExp = parseFechaISO(expedicion)
  const tObj = parseFechaISO(objetivo)
  if (tExp === null || tObj === null) return null
  const dias = Math.round((tObj - tExp) / DIA_MS)
  // Un documento expedido DESPUÉS de la fecha objetivo también sirve: es más nuevo.
  return dias <= vigenciaDias
}

/** Días que tendrá el documento el día objetivo. Null si falta alguna fecha. */
export function diasAlObjetivo(expedicion: unknown, objetivo: unknown): number | null {
  const tExp = parseFechaISO(expedicion)
  const tObj = parseFechaISO(objetivo)
  if (tExp === null || tObj === null) return null
  return Math.round((tObj - tExp) / DIA_MS)
}

/**
 * Los cuatro estados en que puede estar un documento perecedero.
 *
 * `vigente`   — sirve el día objetivo. No hay nada que hacer.
 * `reemplazar`— no sirve, y YA se puede pedir uno que sí sirva (el objetivo cae
 *               dentro de la ventana de vigencia contada desde hoy). Es accionable.
 * `esperar`   — no sirve, y pedirlo HOY tampoco serviría: uno expedido hoy también
 *               llegaría vencido. Hay que esperar hasta `pedirDesde`.
 * `no_comprobable` — falta la fecha de expedición o la fecha objetivo. **No es
 *               aprobado**: es que no se pudo comprobar, y quien lo consuma debe
 *               mostrarlo como tal en vez de callarlo.
 */
export type EstadoVigencia = 'vigente' | 'reemplazar' | 'esperar' | 'no_comprobable'

export interface VigenciaDocumento {
  estado: EstadoVigencia
  /** Días que tendrá el documento el día objetivo. Null si no se pudo calcular. */
  diasAlObjetivo: number | null
  /**
   * Primer día en que tiene sentido pedir el reemplazo: `objetivo - vigenciaDias`.
   * Solo viene en `reemplazar` y `esperar`. **Se calcula, nunca se guarda**: si la
   * fecha objetivo se mueve (la DIAN reprograma citas), un valor congelado mandaría
   * a pedir el documento el día equivocado y la pantalla seguiría viéndose bien.
   */
  pedirDesde: string | null
}

/**
 * Estado de vigencia de un documento contra el día en que se va a usar.
 *
 * ⚠️ EL RELOJ ENTRA COMO PARÁMETRO (`hoyISO`), no se lee adentro. Dos razones, las
 * mismas de `antiguedad.ts`: se puede probar sin congelar el reloj global, y quien
 * llama toma UNA marca de tiempo para todo el lote (si cada fila leyera la hora por
 * su cuenta, dos documentos idénticos podrían salir con estados distintos al cruzar
 * la medianoche a mitad del recorrido). En el servidor se pasa `todayBogotaISO()`:
 * Vercel corre en UTC y después de las 19:00 en Colombia el día ya cambió allá.
 *
 * Sin `hoyISO` no se puede distinguir `reemplazar` de `esperar`, así que todo lo que
 * no sirve se reporta como `reemplazar` — el lado que pide acción, no el que la
 * aplaza.
 */
export function estadoVigencia(
  expedicion: unknown,
  objetivo: unknown,
  opts?: { vigenciaDias?: number; hoyISO?: string },
): VigenciaDocumento {
  const vigenciaDias = opts?.vigenciaDias ?? VIGENCIA_DIAS_DEFAULT
  const tExp = parseFechaISO(expedicion)
  const tObj = parseFechaISO(objetivo)

  if (tExp === null || tObj === null) {
    return { estado: 'no_comprobable', diasAlObjetivo: null, pedirDesde: null }
  }

  const dias = Math.round((tObj - tExp) / DIA_MS)
  if (dias <= vigenciaDias) {
    return { estado: 'vigente', diasAlObjetivo: dias, pedirDesde: null }
  }

  // No sirve. ¿Ya vale la pena pedir el reemplazo, o uno pedido hoy también llegaría
  // vencido? La respuesta decide si el equipo actúa hoy o agenda.
  const tPedirDesde = tObj - vigenciaDias * DIA_MS
  const pedirDesde = isoDeTimestamp(tPedirDesde)
  const tHoy = parseFechaISO(opts?.hoyISO)
  const estado: EstadoVigencia = tHoy === null || tHoy >= tPedirDesde ? 'reemplazar' : 'esperar'

  return { estado, diasAlObjetivo: dias, pedirDesde }
}
