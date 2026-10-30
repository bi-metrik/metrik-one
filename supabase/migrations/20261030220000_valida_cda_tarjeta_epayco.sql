-- ============================================================
-- 20261030220000 — Pago automático con tarjeta (ePayco) para los CDA de Valida
--
-- Diseño aprobado por Mauricio el 2026-10-30
-- (proyectos/metrik/valida/docs/legal/2026-10-30_diseno-tarjeta-cda-epayco.md), sobre los Términos
-- v1.5 del Plan CDA, cláusulas 2.4 (débito automático), 11.1, 11.7 y 12.2.
--
-- ## Qué escribe: DDL de UNA tabla nueva, su función de guarda y su trigger. Ni una fila de datos.
--
-- Nada cambia para nadie al aplicarla: la tabla nace vacía y la llena solo la persona designada de un
-- CDA cuando registra su tarjeta en /suscripcion (pestaña Pagos). No toca `planes_cobro` ni ninguna
-- otra fila existente: la pasarela del plan pasa de `bold` a `epayco` recién cuando el CDA registra.
--
-- ## Por qué una tabla nueva y no columnas en `servicios_contratados` o `valida_registros`
--
-- `valida_registros` es del alta autogestionada (los CDA no tienen fila ahí) y `servicios_contratados`
-- es el contrato: la tarjeta cambia (se cambia, se quita) y cada registro es la constancia de una
-- autorización de débito (2.4) con su texto, su huella, quién, cuándo y desde dónde. Una fila por
-- registro, inmutable salvo su cierre, como `planes_anuales_cda`.
--
-- ## Las columnas que deciden el cobro
--
--   - `estado`: `activa` (la que cobra; una sola por contrato), `reemplazada` (se cambió por otra) o
--     `quitada` (el plan volvió al enlace de pago).
--   - `cobro_desde`: el día (Bogotá) en que se registró la PRIMERA tarjeta de la serie. El cobro
--     automático alcanza solo los períodos que EMPIEZAN después de ese día; lo de antes nunca se cobra
--     solo (D3). Cambiar la tarjeta lo conserva; quitarla y volver a registrar lo vuelve a fijar.
--   - `dia_renovacion`: el día de renovación del texto de la v1.5 de ESE CDA (2.4), el que dice la
--     casilla. No es una constante.
--   - `terminos_vigente_desde`: la vigencia de la v1.5 aceptada (11.7); con ella se dice en el aviso de un
--     cobro rechazado desde cuándo se pausan las consultas nuevas.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select relname, relrowsecurity, relacl::text from pg_class where oid = 'public.tarjetas_pago_cda'::regclass;
--     -> true, sin anon ni authenticated
--   select p.proacl::text from pg_proc p where p.oid = 'public.tarjetas_pago_cda_guardas()'::regprocedure;
--     -> sin `anon=`, sin `authenticated=` y sin `=X/`
--   select count(*) from public.tarjetas_pago_cda;  -> 0
--
-- ## Cómo revertir (mientras ningún CDA haya registrado tarjeta)
--
--   drop table public.tarjetas_pago_cda;
--   drop function public.tarjetas_pago_cda_guardas();
-- ============================================================

create table public.tarjetas_pago_cda (
  id uuid primary key default gen_random_uuid(),

  -- Donde viven el plan, las cuotas y los cobros: el espacio que COBRA (metrik).
  workspace_id uuid not null references public.workspaces(id),
  -- El espacio del CDA que paga el contrato y registra la tarjeta.
  workspace_cliente_id uuid not null references public.workspaces(id),
  servicio_contratado_id uuid not null references public.servicios_contratados(id),
  negocio_id uuid not null references public.negocios(id),
  plan_cobro_id uuid not null references public.planes_cobro(id),

  estado text not null default 'activa'
    constraint tarjetas_pago_cda_estado check (estado in ('activa', 'reemplazada', 'quitada')),

  -- ── La tarjeta: un puntero a ePayco, nunca la tarjeta ──
  -- `epayco:<customerId>:<cardTokenId>` (`refMedioPagoEpayco`).
  metodo_pago_ref text not null
    constraint tarjetas_pago_cda_ref check (metodo_pago_ref ~ '^epayco:[A-Za-z0-9_-]{4,64}:[A-Za-z0-9_-]{4,64}$'),
  ultimos4 text
    constraint tarjetas_pago_cda_ultimos4 check (ultimos4 is null or ultimos4 ~ '^[0-9]{4}$'),
  -- Lo que ePayco pide en cada cobro: el titular (nombres, apellidos, tipo y número de documento), su
  -- celular y el correo con que se creó el cliente en ePayco.
  titular jsonb not null
    constraint tarjetas_pago_cda_titular check (jsonb_typeof(titular) = 'object'),
  celular text not null
    constraint tarjetas_pago_cda_celular check (celular ~ '^3[0-9]{9}$'),
  correo text not null
    constraint tarjetas_pago_cda_correo check (length(btrim(correo)) between 3 and 254),

  -- ── Qué cobra ──
  cobro_desde date not null,
  dia_renovacion smallint not null
    constraint tarjetas_pago_cda_dia check (dia_renovacion between 1 and 31),

  -- ── La constancia de la autorización (2.4) ──
  terminos_documento_id uuid not null references public.documentos_contractuales_versiones(id),
  terminos_vigente_desde date not null,
  autorizacion_texto text not null
    constraint tarjetas_pago_cda_autorizacion_largo check (char_length(autorizacion_texto) between 1 and 1000),
  autorizacion_sha256 text not null
    constraint tarjetas_pago_cda_autorizacion_sha check (autorizacion_sha256 ~ '^[0-9a-f]{64}$'),
  -- La persona REAL de la sesión (nunca la de «Ver como»): la persona designada del contrato.
  usuario_id uuid not null references public.profiles(id),
  ip text,
  user_agent text,
  autorizado_at timestamptz not null default now(),

  -- ── El cierre (cambio o retiro) ──
  cerrada_at timestamptz,
  cerrada_por uuid references public.profiles(id),
  -- Lo que respondió ePayco al pedirle borrar la tarjeta: 'ok' o el error.
  borrado_epayco text
    constraint tarjetas_pago_cda_borrado_largo check (borrado_epayco is null or char_length(borrado_epayco) <= 300),

  created_at timestamptz not null default now(),

  constraint tarjetas_pago_cda_cierre check ((estado = 'activa') = (cerrada_at is null))
);

alter table public.tarjetas_pago_cda enable row level security;
-- server-only: la escriben las acciones de /suscripcion (la persona designada, tras `contextoSuscripcion`) con service_role y la lee el cron `procesar-planes-cobro` (pasos 6 y 7b). Nadie con sesión la lee: no tiene policy.
revoke all on table public.tarjetas_pago_cda from public, anon, authenticated;

-- Una sola tarjeta que cobra por contrato.
create unique index uq_tarjetas_pago_cda_activa
  on public.tarjetas_pago_cda (servicio_contratado_id) where estado = 'activa';
create index idx_tarjetas_pago_cda_plan on public.tarjetas_pago_cda (plan_cobro_id) where estado = 'activa';

comment on table public.tarjetas_pago_cda is
  'Pago automático con tarjeta (ePayco) de un CDA de Valida (Términos v1.5, 2.4): la referencia de la tarjeta en ePayco, sus 4 últimos dígitos y la constancia de la autorización de débito (texto, huella, persona, IP, dispositivo, fecha). Una fila por registro; lo autorizado no cambia ni se borra, solo se cierra.';

-- Lo autorizado no cambia: solo el cierre (estado, cuándo, quién, el borrado en ePayco) y los 4 últimos
-- dígitos si ePayco no los dio al registrar. Una tarjeta cerrada no vuelve a cobrar. No se borra.
create or replace function public.tarjetas_pago_cda_guardas()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  editables constant text[] := array['estado', 'cerrada_at', 'cerrada_por', 'borrado_epayco', 'ultimos4'];
begin
  if tg_op = 'DELETE' then
    raise exception 'tarjetas_pago_cda %: es la constancia de una autorización de débito; no se borra', old.id;
  end if;
  if (to_jsonb(new) - editables) is distinct from (to_jsonb(old) - editables) then
    raise exception 'tarjetas_pago_cda %: lo autorizado no cambia', old.id;
  end if;
  if old.ultimos4 is not null and new.ultimos4 is distinct from old.ultimos4 then
    raise exception 'tarjetas_pago_cda %: los últimos dígitos no cambian', old.id;
  end if;
  if old.estado <> 'activa' and new.estado is distinct from old.estado then
    raise exception 'tarjetas_pago_cda %: una tarjeta cerrada no vuelve a cobrar', old.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.tarjetas_pago_cda_guardas() from public, anon, authenticated;

create trigger trg_tarjetas_pago_cda_guardas
  before update or delete on public.tarjetas_pago_cda
  for each row execute function public.tarjetas_pago_cda_guardas();
