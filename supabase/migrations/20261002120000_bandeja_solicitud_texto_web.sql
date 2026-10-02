-- ============================================================
-- La solicitud de viaje sin formulario: lo pegado en la web entra a la bandeja
-- ------------------------------------------------------------
-- Diseño: proyectos/trappvel/clarity/docs/diseno/noor-solicitud-sin-formulario-2026-10-02.md §3.
--
-- La web pega o escribe el texto del cliente y el MISMO motor del bot lo entiende
-- (función `solicitud-texto`). Para que lo pegado deje el mismo rastro que lo reenviado
-- (entrega, mensajes con su clase, entendimiento, `entrega_id` en la marca), las tres
-- tablas de la bandeja dejan de suponer WhatsApp:
--   · `canal` ('whatsapp' por defecto | 'web') en entregas y entendimientos: el cron
--     solo toma `canal <> 'web'` (código, `procesarEntendimientos`). Una entrega web
--     nunca contesta por WhatsApp;
--   · `remitente_phone` nulo SOLO si es web (entregas, entendimientos) o si el mensaje
--     es web (`wa_message_id` con el prefijo `web:`, decisión de Max: así el id sigue
--     `not null unique` y ningún índice cambia);
--   · motivo de cierre `web` (la entrega web nace cerrada, no por inactividad);
--   · estado `por_confirmar` del entendimiento: entendido, sin «Cargar» todavía.
--
-- Solo esquema: no toca ninguna fila. Las filas que ya existen quedan `whatsapp` por el
-- default y todas tienen teléfono, así que los checks nuevos se cumplen al crearse.
-- Ninguna tabla, función ni vista nueva: grants y RLS quedan como estaban.
-- ============================================================

-- ── Entregas ─────────────────────────────────────────────────────────────────

alter table public.wa_bandeja_entregas
  add column canal text not null default 'whatsapp'
    constraint wa_bandeja_entregas_canal check (canal in ('whatsapp', 'web'));

alter table public.wa_bandeja_entregas alter column remitente_phone drop not null;
alter table public.wa_bandeja_entregas
  add constraint wa_bandeja_entregas_telefono_web check (canal = 'web' or remitente_phone is not null);

alter table public.wa_bandeja_entregas drop constraint wa_bandeja_entregas_motivo;
alter table public.wa_bandeja_entregas
  add constraint wa_bandeja_entregas_motivo check (motivo_cierre in ('inactividad', 'palabra_cierre', 'web'));

-- ── Mensajes ─────────────────────────────────────────────────────────────────

alter table public.wa_bandeja_mensajes alter column remitente_phone drop not null;
alter table public.wa_bandeja_mensajes
  add constraint wa_bandeja_mensajes_telefono_web check (remitente_phone is not null or wa_message_id like 'web:%');

-- ── Entendimientos ───────────────────────────────────────────────────────────

alter table public.wa_bandeja_entendimientos
  add column canal text not null default 'whatsapp'
    constraint wa_bandeja_entendimientos_canal check (canal in ('whatsapp', 'web'));

alter table public.wa_bandeja_entendimientos alter column remitente_phone drop not null;
alter table public.wa_bandeja_entendimientos
  add constraint wa_bandeja_entendimientos_telefono_web check (canal = 'web' or remitente_phone is not null);

alter table public.wa_bandeja_entendimientos drop constraint wa_bandeja_entendimientos_estado;
alter table public.wa_bandeja_entendimientos
  add constraint wa_bandeja_entendimientos_estado check (estado in (
    'procesando', 'error', 'esperando_negocio', 'esperando_contacto', 'negocio_creado',
    'negocio_actualizado', 'descartada', 'repartida', 'por_confirmar'
  ));

comment on column public.wa_bandeja_entregas.canal is
  'Por dónde llegó: whatsapp (reenviado al bot) o web (pegado en la caja de la solicitud). El cron solo toma whatsapp.';
comment on column public.wa_bandeja_entendimientos.canal is
  'Por dónde llegó la entrega. web: se entiende y se carga en la petición de quien pegó; el cron no la toma ni la reintenta.';
