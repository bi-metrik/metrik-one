/**
 * Plazos de conservación de los registros del bot de WhatsApp.
 *
 * Aprobados por Mauricio el 2026-09-15 y publicados en la Política de Datos
 * de Valida v1.4. Quien los EJECUTA es `public.purgar_registros_bot()`
 * (migración `20260915060000_purga_registros_bot.sql`), que corre cada día
 * por pg_cron; esta constante no borra nada.
 *
 * Por qué existe si el SQL ya los tiene escritos: porque la Política no se
 * publica sin la purga en producción, y la prueba `purga-sql.test.ts` usa
 * ESTOS números para armar los bordes de cada plazo (un día antes, un día
 * después) y los corre contra esa migración en Postgres. Si alguien mueve un
 * plazo en el SQL y no aquí —o al revés— cae la prueba; y si los mueve en los
 * dos lados, cae el pin contra la Política v1.4, que exige tocar la prueba y
 * por tanto decirlo.
 *
 * Los años de la aceptación salen de `RETENCION_ANIOS` (Ley 962 de 2005,
 * art. 28): el mismo plazo de conservación que ya rige el expediente de
 * vinculación, contado desde el fin del contrato.
 */
import { RETENCION_ANIOS } from '@/lib/compliance/retencion'

export const PLAZOS_BOT = {
  /** `aceptaciones_terminos` respondidas, sus acciones, el acuse copiado y el PDF: años tras `contrato_fin`. */
  aceptacionRespondidaAniosTrasContrato: RETENCION_ANIOS,
  /** `aceptaciones_terminos` pendientes o vencidas: días después de `expira_at`. */
  aceptacionSinRespuestaDiasTrasVencer: 90,
  /** `wa_message_log`: días; al vencer se anulan teléfono y texto. */
  conversacionesDias: 90,
  /** `wa_envios`: meses; al vencer se anulan teléfono, texto y wamid. */
  acusesMeses: 12,
  /** `bot_sessions`: días después de `expires_at`; al vencer se borran. */
  sesionesDiasTrasVencer: 7,
} as const

/** Bucket privado de los PDF que se aceptan por el bot. */
export const BUCKET_ACEPTACIONES = 'aceptaciones-documentos'

/**
 * Los únicos buckets de los que el cron de purga puede borrar. Una fila de la
 * cola que apunte a otro bucket se ignora: la cola la llena SQL y no hay razón
 * para que un error ahí se convierta en archivos borrados en otra parte.
 */
export const BUCKETS_PURGABLES: readonly string[] = [BUCKET_ACEPTACIONES]

/** Zona en la que se lee "un día" de `retencion_hasta`. */
export const ZONA_PLAZOS = 'America/Bogota'
