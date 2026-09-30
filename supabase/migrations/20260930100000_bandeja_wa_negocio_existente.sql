-- ============================================================
-- 20260930100000 — La bandeja de WhatsApp carga en un negocio existente
--
-- Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-30-bandeja-a-negocio-existente.md
-- Base: 20260925200000 (bandeja) y 20260929100000 (entendimiento), ya aplicadas.
--
-- Qué cambia: al cerrar una entrega el bot ya no pregunta «¿De qué cliente es?» sino «¿A qué
-- viaje van?», con una lista corta numerada de negocios abiertos y «NUEVO». Hace falta:
--   1. `wa_bandeja_entregas.negocio_opciones`: la lista EXACTA que se ofreció, para que «2»
--      signifique lo mismo al contestar aunque entre tanto se abra otro negocio. Nula = la
--      entrega se preguntó con el texto viejo (o la lista no se pudo armar): camino anterior.
--   2. En `wa_bandeja_entendimientos`:
--      · `destino` ('nuevo' | 'existente') y `negocio_destino_id`: a dónde va la entrega;
--      · `esperando_negocio` + `pregunta_negocio_at` / `respuesta_negocio` / `respuesta_negocio_at`:
--        la respuesta no se entendió y se volvió a preguntar;
--      · `negocio_actualizado`: se cargó en un negocio que ya existía (`negocio_id` = ese);
--      · `cargados` (slugs escritos) y `conflictos` ([{slug, actual, valor, frase}]): lo que el
--        mensaje dijo distinto a lo que el negocio ya tenía. El valor NO se cambia; la marca
--        vive en `negocio_bloques.data._conflictos[slug]` y la decide una persona.
--   3. Papel `respuesta_negocio` en los mensajes: la respuesta a la re-pregunta, guardada como
--      todo lo demás de la bandeja.
--   4. Índice por `negocio_id`: desde el negocio se consultan sus entregas y sus mensajes crudos.
--   5. El cron también llama cuando llega la respuesta a la re-pregunta.
--
-- Sin datos que migrar: la bandeja sigue apagada (`modules.bandeja_solicitudes_wa`) y las
-- columnas nuevas nacen nulas. No toca filas existentes.
--
-- ORDEN: esta migración ANTES del deploy de `wa-alerts` y `wa-webhook` (el código escribe las
-- columnas nuevas). Redefinir el cron antes del deploy es inocuo: la condición nueva mira un
-- estado que solo el código nuevo produce.
--
-- Verificación después de aplicar (solo lectura):
--   select column_name from information_schema.columns
--    where table_name = 'wa_bandeja_entregas' and column_name = 'negocio_opciones';   -> 1 fila
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'wa_bandeja_entendimientos_estado';
--     -> incluye esperando_negocio y negocio_actualizado
-- ============================================================

-- ── 1. La lista ofrecida ─────────────────────────────────────────────────────
alter table public.wa_bandeja_entregas
  add column negocio_opciones jsonb;

comment on column public.wa_bandeja_entregas.negocio_opciones is
  'Lista ofrecida en «¿A qué viaje van?»: [{id, codigo, cliente, destino, propuesto}]. [] = solo NUEVO. Nula = pregunta vieja.';

-- ── 2. A dónde va la entrega ─────────────────────────────────────────────────
alter table public.wa_bandeja_entendimientos
  add column destino text
    constraint wa_bandeja_entendimientos_destino check (destino in ('nuevo', 'existente')),
  add column negocio_destino_id uuid references public.negocios(id) on delete set null,
  add column pregunta_negocio_at timestamptz,
  add column respuesta_negocio text,
  add column respuesta_negocio_at timestamptz,
  add column cargados jsonb,
  add column conflictos jsonb;

alter table public.wa_bandeja_entendimientos drop constraint wa_bandeja_entendimientos_estado;
alter table public.wa_bandeja_entendimientos add constraint wa_bandeja_entendimientos_estado
  check (estado in (
    'procesando', 'error', 'esperando_negocio', 'esperando_contacto',
    'negocio_creado', 'negocio_actualizado', 'descartada'
  ));

drop index if exists public.wa_bandeja_entendimientos_pendientes;
create index wa_bandeja_entendimientos_pendientes
  on public.wa_bandeja_entendimientos (estado, updated_at)
  where estado in ('error', 'esperando_contacto', 'esperando_negocio');

drop index if exists public.wa_bandeja_entendimientos_remitente;
create index wa_bandeja_entendimientos_remitente
  on public.wa_bandeja_entendimientos (workspace_id, remitente_phone)
  where estado in ('esperando_contacto', 'esperando_negocio');

create index wa_bandeja_entendimientos_negocio
  on public.wa_bandeja_entendimientos (negocio_id)
  where negocio_id is not null;

-- ── 3. Papel nuevo en los mensajes ───────────────────────────────────────────
alter table public.wa_bandeja_mensajes drop constraint wa_bandeja_mensajes_papel;
alter table public.wa_bandeja_mensajes add constraint wa_bandeja_mensajes_papel
  check (papel in ('contenido', 'cierre', 'respuesta_cliente', 'respuesta_contacto', 'respuesta_negocio'));

-- ── 4. El cron también atiende la respuesta a «¿A qué viaje van?» ────────────
select cron.unschedule('wa-bandeja-entendimiento')
where exists (select 1 from cron.job where jobname = 'wa-bandeja-entendimiento');

select cron.schedule(
  'wa-bandeja-entendimiento',
  '* * * * *',
  $cron$
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_FUNCTIONS_URL') || '/wa-alerts',
  body := '{"action":"bandeja_entendimiento"}'::jsonb,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'WA_ALERTS_SECRET')
  )
)
where exists (
  select 1 from public.wa_bandeja_entregas e
  where e.estado = 'con_cliente'
    and not exists (select 1 from public.wa_bandeja_entendimientos x where x.entrega_id = e.id)
)
or exists (
  select 1 from public.wa_bandeja_entendimientos x
  where (x.estado = 'error' and x.intentos < 3 and x.negocio_id is null and x.contacto_id is null)
     or (x.estado = 'esperando_contacto' and x.respuesta_contacto is not null)
     or (x.estado = 'esperando_negocio' and x.respuesta_negocio is not null)
);
  $cron$
);
