-- ============================================================================
-- 20260924030000 — Bitácora de eventos de pasarela de pago en línea (hoy Bold; ePayco después)
--
-- Una fila por notificación que llega a la ruta de webhook de una pasarela (`/api/webhooks/<pasarela>`)
-- con la firma válida. Genérica a propósito: Bold es temporal y todo migra a ePayco, así que la tabla
-- habla de pasarela + id, nunca de un proveedor. Sirve para dos
-- cosas, y las dos son la razón de que exista:
--
--   1. Idempotencia por notificación: `unique (pasarela, evento_id)`. Bold reintenta hasta 5 veces
--      y puede mandar varias notificaciones de la misma venta; una notificación que ya terminó se
--      contesta sin tocar nada, y una que quedó a medias (resultado 'recibido') se vuelve a procesar.
--   2. Rastro: qué llegó, qué hizo ONE con ello y por qué. Lo que ONE deja para revisión
--      ('requiere_revision': doble pago, pago por menos, anulación) queda aquí con su motivo y
--      además en el timeline del negocio.
--
-- Una notificación con firma inválida NO deja fila: sin firma no hay forma de saber de quién es, y
-- guardarla abriría la tabla a cualquiera que conozca la URL.
--
-- Solo DDL: ninguna fila se inserta ni se reescribe. Nace vacía.
-- ============================================================================

create table public.pasarela_eventos (
  id uuid primary key default gen_random_uuid(),
  pasarela text not null
    constraint pasarela_eventos_pasarela check (pasarela in ('bold', 'epayco')),
  -- Id de la notificación en la pasarela. Clave de idempotencia junto con la pasarela.
  evento_id text not null
    constraint pasarela_eventos_evento_id check (char_length(evento_id) between 1 and 200),
  -- El tipo de evento tal cual lo manda la pasarela (en Bold: SALE_APPROVED, SALE_REJECTED...).
  tipo text not null,
  -- La transacción en la pasarela. El pago queda en `cobros.external_ref` con la forma que decide
  -- el adaptador (Bold: 'bold-' || esto) y `cobros.fuente = pasarela`.
  transaccion_id text not null,
  -- La referencia que volvió: la de ONE (ONE-<cobro>-<ms>) o el id del enlace de la pasarela.
  referencia text,
  monto numeric,
  moneda text,
  -- El cobro al que se aplicó, y su espacio. NULL si no se encontró (venta por otro canal).
  -- SET NULL: borrar un cobro no puede llevarse el rastro de la plata que llegó por él.
  cobro_id uuid references public.cobros(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  resultado text not null default 'recibido'
    constraint pasarela_eventos_resultado check (
      resultado in ('recibido', 'registrado', 'ya_pagado', 'ignorado', 'sin_cobro', 'requiere_revision')
    ),
  detalle text,
  -- El cuerpo tal cual llegó (ya verificado). Trae el correo del pagador: server-only.
  payload jsonb not null default '{}'::jsonb,
  recibido_at timestamptz not null default now(),
  procesado_at timestamptz,
  constraint pasarela_eventos_unico unique (pasarela, evento_id)
);

create index pasarela_eventos_cobro on public.pasarela_eventos (cobro_id) where cobro_id is not null;
create index pasarela_eventos_revision on public.pasarela_eventos (recibido_at desc)
  where resultado = 'requiere_revision';

alter table public.pasarela_eventos enable row level security;
-- server-only: la escribe y la lee solo el webhook de la pasarela con el cliente de servicio; trae el correo del pagador y ningún cliente con sesión la consulta.
revoke all on table public.pasarela_eventos from public, anon, authenticated;

comment on table public.pasarela_eventos is
  'Notificaciones de pasarela de pago en línea con firma válida: idempotencia por (pasarela, evento_id) y rastro de qué hizo ONE con cada una. Server-only.';
comment on column public.pasarela_eventos.resultado is
  'recibido (a medias: se reprocesa) | registrado | ya_pagado | ignorado | sin_cobro | requiere_revision.';
