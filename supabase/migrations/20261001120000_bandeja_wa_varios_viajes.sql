-- ============================================================
-- 20261001120000 — Bandeja de WhatsApp: varios viajes en una entrega y guardianes
--
-- Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-01-varios-viajes-y-guardianes.md
-- Base: 20260925200000, 20260929100000 y 20260930100000 (todas aplicadas).
--
-- Qué cambia:
--   1. La asignación es POR MENSAJE y queda guardada (para auditar de dónde salió cada dato):
--      · `wa_bandeja_mensajes.segmento`: el número del viaje (1, 2…) dentro de la entrega al que
--        se cargó el mensaje; nulo = no se cargó (sin asignar, descartado, encabezado);
--      · `wa_bandeja_mensajes.asignacion`: {destino, por, evidencia, motivo, varios, descartado,
--        confirmado_at}. `por` = encabezado | modelo | bloque | comercial;
--      · `wa_bandeja_mensajes.clase`: quién habla (N3): cliente | comercial | tercero | ruido |
--        encabezado. Solo lo del cliente llena campos.
--   2. `wa_bandeja_entregas.plan_viajes`: el reparto propuesto (modo encabezado/mixto) que el
--      comercial confirma o corrige. Nada se carga hasta el «sí». `plan_confirmado_at`: cuándo.
--   3. `wa_bandeja_entendimientos`:
--      · `segmento` (0 = la entrega entera; 1, 2… = un viaje del reparto). El reclamo pasa a ser
--        único por (entrega, segmento): cada viaje se entiende y se carga por separado;
--      · estado nuevo `repartida`: la fila 0 de una entrega cuyo reparto se confirmó;
--      · `confirmacion_pendiente`: qué espera el bot del comercial además de «¿A qué viaje van?»
--        — `cruce` (N6, los mensajes hablan de otro viaje), `sin_solicitud` (N4) o `dos_viajes`
--        (N5). La respuesta llega por la misma vía (`respuesta_negocio`).
--
-- Sin datos que migrar: la bandeja sigue apagada (`modules.bandeja_solicitudes_wa`), las columnas
-- nuevas nacen nulas y `segmento` nace en 0 (lo que tiene hoy cada fila). Sin tablas ni funciones
-- nuevas: los permisos y el RLS de las tres tablas no cambian. El cron no cambia: los estados que
-- espera respuesta siguen siendo `esperando_negocio` y `esperando_contacto`.
--
-- ORDEN: esta migración ANTES del deploy de `wa-alerts` y `wa-webhook` (el código escribe las
-- columnas nuevas y el upsert usa la unicidad nueva). Ojo: el upsert del código viejo,
-- `on conflict (entrega_id)`, se queda sin índice que lo respalde, así que el deploy va
-- inmediatamente después. Con la bandeja apagada el código viejo nunca llega a ese upsert.
--
-- Verificación después de aplicar (solo lectura):
--   select column_name from information_schema.columns
--    where table_name = 'wa_bandeja_mensajes' and column_name in ('segmento', 'asignacion', 'clase');   -> 3 filas
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'wa_bandeja_entendimientos_entrega_segmento';
--     -> UNIQUE (entrega_id, segmento)
-- ============================================================

-- ── 1. Asignación por mensaje ────────────────────────────────────────────────
alter table public.wa_bandeja_mensajes
  add column segmento integer
    constraint wa_bandeja_mensajes_segmento check (segmento is null or segmento >= 1),
  add column asignacion jsonb,
  add column clase text
    constraint wa_bandeja_mensajes_clase check (clase in ('cliente', 'comercial', 'tercero', 'ruido', 'encabezado'));

comment on column public.wa_bandeja_mensajes.segmento is
  'Viaje (1, 2…) de la entrega al que se cargó el mensaje. Nulo = no se cargó en ninguno.';
comment on column public.wa_bandeja_mensajes.asignacion is
  'A qué viaje va y por qué: {destino, por: encabezado|modelo|bloque|comercial, evidencia, motivo, varios, descartado, confirmado_at}.';
comment on column public.wa_bandeja_mensajes.clase is
  'Quién habla (N3): cliente | comercial | tercero | ruido | encabezado. Solo lo del cliente llena campos.';

create index wa_bandeja_mensajes_segmento
  on public.wa_bandeja_mensajes (entrega_id, segmento)
  where segmento is not null;

-- ── 2. El reparto propuesto ──────────────────────────────────────────────────
alter table public.wa_bandeja_entregas
  add column plan_viajes jsonb,
  add column plan_confirmado_at timestamptz;

comment on column public.wa_bandeja_entregas.plan_viajes is
  'Reparto por mensaje (modo encabezado/mixto): {version, mensajes:[{n, destino, por, evidencia, motivo, varios, descartado}], encabezados, avisos}. Nulo = modo uno.';

-- ── 3. Un entendimiento por viaje del reparto ────────────────────────────────
alter table public.wa_bandeja_entendimientos
  add column segmento integer not null default 0
    constraint wa_bandeja_entendimientos_segmento_valido check (segmento >= 0),
  add column confirmacion_pendiente text
    constraint wa_bandeja_entendimientos_confirmacion check (confirmacion_pendiente in ('cruce', 'sin_solicitud', 'dos_viajes'));

alter table public.wa_bandeja_entendimientos drop constraint wa_bandeja_entendimientos_entrega;
alter table public.wa_bandeja_entendimientos
  add constraint wa_bandeja_entendimientos_entrega_segmento unique (entrega_id, segmento);

alter table public.wa_bandeja_entendimientos drop constraint wa_bandeja_entendimientos_estado;
alter table public.wa_bandeja_entendimientos add constraint wa_bandeja_entendimientos_estado
  check (estado in (
    'procesando', 'error', 'esperando_negocio', 'esperando_contacto',
    'negocio_creado', 'negocio_actualizado', 'descartada', 'repartida'
  ));
