-- El CHECK de `activity_log.tipo` se pone al día con los tipos que el código INSERTA
--
-- ## El defecto
--
-- `activity_log_tipo_check` admitía 7 valores (migración 20260622000004) y el código
-- inserta 15. Los 8 que faltaban rebotaban con `23514 violates check constraint`, y
-- como ningún insert leía el `error`, la fila desaparecía sin que nadie se enterara.
-- El síntoma es idéntico al del caso sano: el timeline no muestra el evento, y no hay
-- forma de saber que falta.
--
-- Medido en producción (yfjqscvvxetobiidnepa) antes de escribir esta migración:
-- **311 aprobaciones de propuesta desde el 2026-04-15 —una por negocio— y CERO
-- filas `propuesta_aprobada` en `activity_log`.** Ojo con el grano: las **754** filas
-- de `negocio_bloques` con `data->>'aprobado_at'` no son 754 eventos. La misma
-- aprobación queda COPIADA en el bloque "Propuesta económica" de cada etapa por la que
-- pasa el negocio (~2,4 filas por negocio), así que los eventos distintos, contados por
-- el par `(negocio_id, aprobado_at)`, son **311, exactamente uno por negocio**. De esas
-- 311, **195 no tienen `aprobado_por`** registrado. El conteo real de la tabla por tipo
-- solo devuelve los 7 del CHECK. Caso que lo destapó: V0429 de SOENA
-- (1e7458e9-7412-4ecb-8285-aeadef38a5d0), Plan 2 con descuento 100% aprobado el
-- 2026-08-26 17:58 y ausente de su propia historia; la reversión posterior sí aparece,
-- porque usa `tipo: 'cambio'`, que sí estaba en el CHECK.
--
-- ## La fuente única del vocabulario
--
-- ⚠️ La lista de abajo NO es un catálogo aparte: es la transcripción de
-- **`src/lib/activity/tipos.ts` → `ACTIVITY_LOG_TIPOS`**, que es la fuente. El
-- contrato entre las dos lo verifica `src/lib/activity/tipos.test.ts`, que lee ESTE
-- archivo y falla si las dos listas dejan de coincidir — sin esa prueba, "hay una sola
-- fuente" sería una afirmación, no un hecho. Es la lección que el CLAUDE.md ya tiene
-- escrita: una lista de valores válidos copiada al lado del catálogo se desincroniza y
-- falla en silencio.
--
-- Para agregar un tipo: primero la constante, luego una migración que reescriba este
-- CHECK completo, y desplegar la migración antes o junto al código que lo inserta.
--
-- ## Qué toca
--
-- `drop constraint` + `add constraint` en la misma transacción (toda migración de
-- Supabase corre en una). **No modifica ninguna fila**: la lista nueva es un
-- superconjunto estricto de la vieja, así que las filas existentes ya pasan el CHECK
-- ampliado y `ADD CONSTRAINT` las valida sin rechazar ninguna.
--
-- `solicitud_conciliacion` y `conciliacion_atendida` se conservan aunque el código ya
-- no los escriba (hoy solo los LEE `count_negocios_por_conciliar` y sus versiones
-- posteriores): hay filas históricas con esos valores y sacarlos haría abortar el
-- `ADD CONSTRAINT` al validarlas.
--
-- ## Vuelta atrás
--
-- Volver al CHECK de 7 valores exige borrar antes las filas con los 8 tipos nuevos, o
-- `ADD CONSTRAINT` aborta. No hay razón para hacerlo: el CHECK viejo describía menos
-- de lo que el sistema hace.

alter table public.activity_log drop constraint if exists activity_log_tipo_check;

alter table public.activity_log add constraint activity_log_tipo_check
  check (tipo in (
    -- Timeline que la gente lee
    'comentario',
    'cambio',
    'sistema',
    'cambio_etapa',
    'cambio_estado',
    'cambio_sistema',
    -- Conciliación (solo lectura hoy; hay filas históricas)
    'solicitud_conciliacion',
    'conciliacion_atendida',
    -- Propuesta económica
    'propuesta_aprobada',
    -- Motor de flujo
    'stage_auto_transition',
    -- Auditoría de plataforma
    'platform_admin_enter',
    'platform_admin_exit',
    -- Google Drive
    'drive_health_failed',
    'drive_folder_skipped',
    'drive_folder_failed'
  ));

comment on constraint activity_log_tipo_check on public.activity_log is
  'Vocabulario de activity_log.tipo. FUENTE: src/lib/activity/tipos.ts '
  '(ACTIVITY_LOG_TIPOS). El contrato lo verifica src/lib/activity/tipos.test.ts. '
  'Agregar un tipo aquí sin agregarlo allá deja el CHECK y el código en desacuerdo.';
