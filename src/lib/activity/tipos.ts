/**
 * Vocabulario canónico de `activity_log.tipo`. **Fuente única.**
 *
 * El CHECK `activity_log_tipo_check` de la base se escribe A PARTIR DE ESTA LISTA
 * (`supabase/migrations/20260901000010_activity_log_tipos_vocabulario.sql`, que cita
 * este archivo por ruta). No hay una segunda copia: una lista de valores válidos
 * copiada al lado del catálogo se desincroniza y falla en silencio — es la lección
 * que el CLAUDE.md ya tiene escrita para `updateContactoSegmento` (2026-08-03), donde
 * el guard se quedó con los cuatro status viejos y rechazó los siete nuevos durante
 * tres días sin que nadie lo notara.
 *
 * ⚠️ **Un tipo que no esté aquí NO entra a la base.** Postgres rechaza la fila con
 * `23514 violates check constraint`, y si el `error` del insert no se lee, la fila
 * desaparece sin que nadie se entere. Por eso todo insert pasa por
 * `registrarActividad` (`./registrar-actividad.ts`), que lee el error y lo reporta.
 *
 * ## Cómo agregar un tipo
 *
 * 1. Agregarlo a `ACTIVITY_LOG_TIPOS`.
 * 2. Escribir una migración que vuelva a escribir el CHECK con la lista completa.
 * 3. Desplegar la migración ANTES o junto al código que lo inserta — al revés, el
 *    insert nuevo rebota contra el CHECK viejo (y ahora sí se ve, pero no se guarda).
 *
 * ## Cómo quitar un tipo
 *
 * Contar primero cuántas filas lo usan en producción. `ALTER TABLE ... ADD CONSTRAINT`
 * valida las filas existentes: si alguna lo usa, la migración aborta.
 */
export const ACTIVITY_LOG_TIPOS = [
  // ── Timeline que la gente lee ──
  /** Comentario escrito por una persona. Único tipo que se puede borrar. */
  'comentario',
  /** Cambio de un campo, hecho por una persona. */
  'cambio',
  /** Evento del sistema sin cambio de campo concreto. */
  'sistema',
  /** El negocio se movió de etapa. */
  'cambio_etapa',
  /** El negocio cambió de estado (cerrado, cancelado, pausado, reabierto). */
  'cambio_estado',
  /** Cambio que hizo el sistema por una regla, no una persona. */
  'cambio_sistema',

  // ── Conciliación ──
  // Los escribía el comercial desde el panel; hoy solo los LEEN
  // `count_negocios_por_conciliar` y sus versiones posteriores. Se conservan porque
  // hay filas históricas con estos valores y porque esas RPC siguen consultándolos:
  // sacarlos del CHECK haría abortar la migración al validar las filas existentes.
  /** Un comercial etiquetó el negocio como "necesita conciliación". */
  'solicitud_conciliacion',
  /** El área financiera limpió esa etiqueta. */
  'conciliacion_atendida',

  // ── Propuesta económica ──
  /** Se aprobó una versión de la propuesta y quedó fijado el honorario. */
  'propuesta_aprobada',

  // ── Motor de flujo ──
  /** Transición de etapa disparada por una regla de `tenant_rules`. */
  'stage_auto_transition',

  // ── Auditoría de plataforma ──
  // Los ve cualquier owner del tenant en su feed: es como se entera de que alguien
  // de MeTRIK entró a su workspace.
  /** Un platform admin de MeTRIK entró al workspace. */
  'platform_admin_enter',
  /** Un platform admin de MeTRIK salió del workspace. */
  'platform_admin_exit',

  // ── Google Drive ──
  // Antes eran `console.error` que solo veía quien leyera los logs de Vercel. En el
  // timeline los ve el dueño del negocio, que es quien puede hacer algo al respecto.
  /** El health check diario de Drive falló para el workspace. */
  'drive_health_failed',
  /** No se creó la carpeta del negocio porque no hay carpeta padre configurada. */
  'drive_folder_skipped',
  /** Falló la creación de la carpeta del negocio en Drive. */
  'drive_folder_failed',
] as const

export type ActivityLogTipo = (typeof ACTIVITY_LOG_TIPOS)[number]

/**
 * ¿Este texto es un tipo válido? Para los pocos bordes donde el valor llega como
 * `string` (por ejemplo el `opts.tipo` de `logSystemChange`, que es una API abierta
 * a llamadores que TypeScript no puede acotar).
 */
export function esActivityLogTipo(valor: string): valor is ActivityLogTipo {
  return (ACTIVITY_LOG_TIPOS as readonly string[]).includes(valor)
}
