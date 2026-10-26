-- ============================================================
-- 20261016100000 — Base propia de suscripciones multiproducto (Valida hoy; Sustenta, Business mañana)
--
-- Decisión de Mauricio (2026-10-15, «ejecuta todo el panel de suscripción»): los clientes de los
-- productos de suscripción NO viven en `negocios` del CRM de `metrik` (esa base es de Clarity,
-- Analytics y Projects). Tienen su propia base, genérica por `producto`, y el MISMO motor de cobro
-- (planes_cobro, plan_cobro_cuotas, cobros, enrolamiento, renovación, token ePayco, enlaces, emisor)
-- cobra «un contrato» que cuelga de un negocio O de una suscripción.
--
-- Spec: `docs/specs/2026-10-16_suscripciones-multiproducto.md`.
--
-- ## Qué crea (vacío)
--
--   1. `suscripciones_producto`: una fila por cliente y producto. El cliente es su espacio de ONE
--      (`workspace_cliente_id`) y la empresa que DECLARÓ (razón social, NIT, correo de facturación),
--      con lo que se verificó del RUT. Sin fila en `empresas` del cobrador: la empresa vive aquí.
--      Lleva el plan, el estado, las fechas de prueba / activación / cancelación, el origen comercial
--      (la marca AFI / pauta / directo de `valida_registros`), la referencia del medio de pago (nunca
--      la tarjeta) y los Términos aceptados (versión + sha256 + la versión registrada).
--      NO se llama `suscripciones`: ese nombre ya lo tiene la tabla de licencias ONE de 20260908120000
--      (0 filas al 2026-10-15), que el paso 5 del cron recorre con su propio ciclo. Mezclarlas metería
--      estas filas en ese ciclo.
--   2. `suscripciones_producto_eventos`: la bitácora (lo que en un negocio es su timeline de
--      `activity_log`, cuyo CHECK de `entidad_tipo` no admite otra entidad). Solo se agrega.
--
-- ## Qué cambia en tablas CON DATOS DE PRODUCCIÓN (solo DDL; ninguna fila se escribe)
--
--   - `servicios_contratados` (11 filas): + `suscripcion_id`; `negocio_id` y `empresa_id` dejan de ser
--     NOT NULL; CHECK: exactamente uno de negocio/suscripción, y empresa sí y solo sí negocio. Las 11
--     filas de hoy tienen negocio y empresa: cumplen.
--   - `planes_cobro` (15 filas): + `suscripcion_id`; `negocio_id` deja de ser NOT NULL; CHECK exactamente
--     uno. Las 15 tienen negocio: cumplen.
--   - `cobros` (594 filas): + `suscripcion_id`; CHECK «no los dos a la vez». `negocio_id` ya era nullable.
--   - `servicio_cobro_enrolamiento` (0 filas): + `suscripcion_id`; `negocio_id` deja de ser NOT NULL;
--     CHECK exactamente uno.
--   - `aceptaciones_terminos` (13 filas): + `suscripcion_id`; los CHECK de los canales `modulo` y
--     `registro` pasan de «negocio obligatorio» a «negocio o suscripción, exactamente uno»; índices
--     únicos gemelos por suscripción.
--   - `documentos_contractuales_versiones` (18 filas): + `suscripcion_id`; un 'cliente' es de una
--     empresa O de una suscripción (exactamente uno); un 'plantilla' de ninguna. Las 18 cumplen.
--
-- Cada ALTER que agrega un CHECK lo valida contra las filas que hay: si alguna fila de producción no
-- cumple, la migración entera aborta y no deja nada.
--
-- ## Cómo verificar después de aplicar
--
--   select count(*) from public.suscripciones_producto;                    -- 0
--   select conname from pg_constraint where conname like '%_ancla%';        -- 5 filas
--   select has_table_privilege('authenticated', 'public.suscripciones_producto', 'select'); -- false
--
-- ## Reversa (mientras no haya filas con suscripcion_id)
--
--   alter table public.documentos_contractuales_versiones drop constraint documentos_versiones_ancla_coherente;
--   alter table public.documentos_contractuales_versiones add constraint documentos_versiones_empresa_coherente
--     check ((alcance = 'cliente') = (empresa_id is not null));
--   drop index public.uq_documentos_versiones_suscripcion;
--   alter table public.documentos_contractuales_versiones drop column suscripcion_id;
--   drop index public.uq_aceptaciones_terminos_modulo_suscripcion;
--   drop index public.uq_aceptaciones_terminos_registro_suscripcion;
--   alter table public.aceptaciones_terminos drop constraint aceptaciones_terminos_ancla,
--     drop constraint aceptaciones_terminos_modulo_completa, drop constraint aceptaciones_terminos_registro_completa;
--   -- re-crear los dos CHECK con el cuerpo de 20260917014500 y 20261014203000 (negocio_id is not null)
--   alter table public.aceptaciones_terminos drop column suscripcion_id;
--   alter table public.servicio_cobro_enrolamiento drop constraint servicio_cobro_enrolamiento_ancla,
--     drop column suscripcion_id, alter column negocio_id set not null;
--   alter table public.cobros drop constraint cobros_ancla, drop column suscripcion_id;
--   alter table public.planes_cobro drop constraint planes_cobro_ancla, drop column suscripcion_id,
--     alter column negocio_id set not null;
--   alter table public.servicios_contratados drop constraint servicios_contratados_ancla,
--     drop constraint servicios_contratados_empresa_por_ancla, drop column suscripcion_id,
--     alter column negocio_id set not null, alter column empresa_id set not null;
--   drop table public.suscripciones_producto_eventos;
--   drop function public.suscripciones_producto_eventos_inmutable();
--   drop table public.suscripciones_producto;
--   drop function public.suscripciones_producto_touch();
--   (`sql/suscripciones-producto/reversa-20261016.sql` lo trae listo, junto con la de 20261016100100)
-- ============================================================


-- ── 1. suscripciones_producto ───────────────────────────────────────────────────────────

-- server-only: la escriben la activación autogestionada (RPC con service_role) y el motor de cobro
-- (cron y webhooks, service_role). El cliente la ve SOLO por las RPC de siempre (`mis_servicios`,
-- `mis_cuotas_de_servicio`, `mis_cobros_de_servicio`, `mis_documentos_de_servicio`), con lista cerrada
-- de campos. Sin grant ni policy para authenticated.
create table public.suscripciones_producto (
  id uuid primary key default gen_random_uuid(),

  -- El cobrador: el espacio que vende y cobra (hoy `metrik`, METRIK IA S.A.S.). El motor de cobro
  -- escribe sus planes y cobros en ESTE espacio, igual que con un negocio.
  workspace_id uuid not null references public.workspaces(id),

  -- El producto, genérico: 'valida', 'sustenta', 'business', … Minúsculas y guion bajo.
  producto text not null
    constraint suscripciones_producto_producto check (producto ~ '^[a-z][a-z0-9_]{1,39}$'),

  -- El cliente: su espacio de ONE. Una suscripción viva por espacio y producto (índice abajo).
  workspace_cliente_id uuid not null references public.workspaces(id),

  -- Para mostrar (pestaña Pagos, /suscripcion): «Valida — CDA EJEMPLO S.A.S.».
  nombre text not null
    constraint suscripciones_producto_nombre check (length(btrim(nombre)) between 1 and 200),

  -- La empresa DECLARADA en el registro, y lo que se verificó. No es una fila de `empresas`.
  razon_social text not null
    constraint suscripciones_producto_razon_social check (length(btrim(razon_social)) between 1 and 300),
  tipo_documento text not null default 'NIT'
    constraint suscripciones_producto_tipo_documento check (tipo_documento in ('NIT', 'CC', 'CE', 'PAS')),
  -- Solo dígitos, sin DV.
  numero_documento text not null
    constraint suscripciones_producto_numero_documento check (numero_documento ~ '^[0-9]{5,15}$'),
  dv text
    constraint suscripciones_producto_dv check (dv is null or dv ~ '^[0-9]$'),
  correo_facturacion text
    constraint suscripciones_producto_correo check (correo_facturacion is null or correo_facturacion ~ '^[^@\s]+@[^@\s]+$'),
  -- El RUT: `coincide` deja la empresa verificada; lo demás lo revisa una persona.
  rut_veredicto text not null default 'sin_rut'
    constraint suscripciones_producto_rut_veredicto check (rut_veredicto in ('coincide', 'no_coincide', 'ilegible', 'sin_rut')),
  empresa_verificada boolean not null default false,
  rut_documento_path text,
  rut_confianza numeric(5, 4),
  -- Lo que la factura electrónica necesita y el RUT dice (tipo de persona, régimen, responsable de
  -- IVA, teléfono…). Vacío = sin leer: la factura usa lo declarado.
  datos_fiscales jsonb not null default '{}'::jsonb
    constraint suscripciones_producto_datos_fiscales check (jsonb_typeof(datos_fiscales) = 'object'),

  -- El plan: la ficha del catálogo con su versión. Los parámetros del cobro viven en el contrato.
  plan_slug text not null references public.catalogo_servicios(slug),

  -- Estado comercial. El de la plata (al día, en mora) lo dicen las cuotas; este es el del contrato.
  estado text not null default 'activa'
    constraint suscripciones_producto_estado check (estado in ('prueba', 'activa', 'suspendida', 'cancelada')),
  prueba_desde timestamptz,
  prueba_hasta timestamptz,
  activada_at timestamptz,
  cancelada_at timestamptz,
  cancelacion_motivo text,

  -- El origen comercial: la marca de `valida_registros` (afi / pauta / directo) y su fuente. De ahí sale
  -- la comisión de AFI cuando Carmen y Mauricio la decidan.
  origen_comercial text,
  origen_fuente text,
  -- El registro autogestionado del que nació (Valida). Otro producto con su propio registro agrega su
  -- columna; esto no es obligatorio.
  valida_registro_id uuid references public.valida_registros(id),

  -- La referencia del medio de pago en la pasarela (p. ej. `epayco:<cliente>:<token>`). NUNCA el número
  -- de la tarjeta ni el CVV: es la llave para pedirle a la pasarela que cobre.
  metodo_pago_pasarela text
    constraint suscripciones_producto_pasarela check (metodo_pago_pasarela is null or metodo_pago_pasarela in ('epayco', 'bold', 'wompi')),
  metodo_pago_ref text,
  constraint suscripciones_producto_metodo_pago check ((metodo_pago_ref is null) = (metodo_pago_pasarela is null)),

  -- Los Términos que rigen: la versión registrada y sus huellas. La constancia de la aceptación vive
  -- en `aceptaciones_terminos` (con `suscripcion_id`).
  terminos_documento_id uuid references public.documentos_contractuales_versiones(id),
  terminos_version text,
  terminos_sha256 text
    constraint suscripciones_producto_terminos_sha check (terminos_sha256 is null or terminos_sha256 ~ '^[0-9a-f]{64}$'),
  terminos_aceptados_at timestamptz,

  metadata jsonb not null default '{}'::jsonb
    constraint suscripciones_producto_metadata check (jsonb_typeof(metadata) = 'object'),
  creado_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint suscripciones_producto_cancelada check ((estado = 'cancelada') = (cancelada_at is not null)),
  constraint suscripciones_producto_prueba check (prueba_hasta is null or prueba_desde is null or prueba_hasta >= prueba_desde)
);

alter table public.suscripciones_producto enable row level security;
revoke all on table public.suscripciones_producto from public, anon, authenticated;

-- Una suscripción viva por espacio y producto: el segundo clic, o dos pestañas, no crean dos.
create unique index uq_suscripciones_producto_viva
  on public.suscripciones_producto (workspace_cliente_id, producto)
  where estado <> 'cancelada';
create index idx_suscripciones_producto_cobrador on public.suscripciones_producto (workspace_id, producto, estado);
create index idx_suscripciones_producto_nit on public.suscripciones_producto (numero_documento);

comment on table public.suscripciones_producto is
  'Clientes de productos de suscripción (Valida, Sustenta, Business…), fuera del CRM de negocios. Una fila por espacio cliente y producto. El motor de cobro cobra su contrato (servicios_contratados.suscripcion_id) igual que el de un negocio. server-only: el cliente la ve por las RPC mis_*.';
comment on column public.suscripciones_producto.workspace_id is 'El cobrador (metrik). Sus planes y cobros viven en este espacio.';
comment on column public.suscripciones_producto.metodo_pago_ref is 'Referencia de la pasarela para cobrar (epayco:<cliente>:<token>). Nunca la tarjeta. Se copia del registro al activar; desde ahí la dueña es esta fila.';
comment on column public.suscripciones_producto.origen_comercial is 'afi | pauta | directo (valida_registros.origen). Base de la comisión del canal, por decidir.';

create or replace function public.suscripciones_producto_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  -- Lo que identifica a la suscripción no se reescribe: otra empresa u otro espacio es otra suscripción.
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.producto is distinct from old.producto
     or new.workspace_cliente_id is distinct from old.workspace_cliente_id
     or new.created_at is distinct from old.created_at then
    raise exception 'suscripciones_producto %: el cobrador, el producto y el espacio del cliente no cambian', old.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.suscripciones_producto_touch() from public, anon, authenticated;

create trigger trg_suscripciones_producto_touch
  before update on public.suscripciones_producto
  for each row execute function public.suscripciones_producto_touch();


-- ── 2. La bitácora ──────────────────────────────────────────────────────────────────────

-- server-only: la escriben el motor de cobro y la activación (service_role) y la lee el equipo de
-- MeTRIK por SQL o por el servidor. El cliente no la consulta.
create table public.suscripciones_producto_eventos (
  id uuid primary key default gen_random_uuid(),
  suscripcion_id uuid not null references public.suscripciones_producto(id),
  -- El cobrador, copiado para leer sin join.
  workspace_id uuid not null references public.workspaces(id),
  tipo text not null
    constraint suscripciones_producto_eventos_tipo check (tipo ~ '^[a-z][a-z0-9_]{1,39}$'),
  detalle text not null
    constraint suscripciones_producto_eventos_detalle check (length(detalle) between 1 and 1000),
  datos jsonb not null default '{}'::jsonb,
  origen text,
  autor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.suscripciones_producto_eventos enable row level security;
revoke all on table public.suscripciones_producto_eventos from public, anon, authenticated;

create index idx_suscripciones_producto_eventos on public.suscripciones_producto_eventos (suscripcion_id, created_at desc);

comment on table public.suscripciones_producto_eventos is
  'Bitácora de una suscripción (alta, cobros con tarjeta, enlaces, rechazos, avisos). Lo que en un negocio es su timeline de activity_log. Solo se agrega.';

create or replace function public.suscripciones_producto_eventos_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'suscripciones_producto_eventos: la bitácora solo se agrega (ni UPDATE ni DELETE)';
end;
$$;
revoke execute on function public.suscripciones_producto_eventos_inmutable() from public, anon, authenticated;

create trigger trg_suscripciones_producto_eventos_inmutable
  before update or delete on public.suscripciones_producto_eventos
  for each row execute function public.suscripciones_producto_eventos_inmutable();


-- ── 3. El contrato cuelga de un negocio O de una suscripción ────────────────────────────

alter table public.servicios_contratados
  add column suscripcion_id uuid references public.suscripciones_producto(id) on delete restrict;
alter table public.servicios_contratados
  alter column negocio_id drop not null,
  alter column empresa_id drop not null;
alter table public.servicios_contratados
  add constraint servicios_contratados_ancla check (num_nonnulls(negocio_id, suscripcion_id) = 1),
  -- Un contrato de negocio es de una empresa del directorio; uno de suscripción, NO (la empresa vive
  -- en la suscripción). Las dos direcciones.
  add constraint servicios_contratados_empresa_por_ancla check ((empresa_id is not null) = (negocio_id is not null));
create index idx_servicios_contratados_suscripcion on public.servicios_contratados (suscripcion_id) where suscripcion_id is not null;

comment on column public.servicios_contratados.suscripcion_id is
  'El ancla del contrato cuando el cliente es una suscripción (suscripciones_producto) y no un negocio del CRM. Exactamente uno de negocio_id / suscripcion_id.';


-- ── 4. El motor de cobro: plan, cobros y acta ───────────────────────────────────────────

alter table public.planes_cobro
  add column suscripcion_id uuid references public.suscripciones_producto(id) on delete restrict;
alter table public.planes_cobro
  alter column negocio_id drop not null;
alter table public.planes_cobro
  add constraint planes_cobro_ancla check (num_nonnulls(negocio_id, suscripcion_id) = 1);
create index idx_planes_cobro_suscripcion on public.planes_cobro (suscripcion_id) where suscripcion_id is not null;

alter table public.cobros
  add column suscripcion_id uuid references public.suscripciones_producto(id) on delete restrict;
-- Un cobro puede no tener ninguno (cobros sueltos de proyectos, los de antes de negocios), pero nunca
-- los dos: sería la plata de dos clientes en una fila.
alter table public.cobros
  add constraint cobros_ancla check (num_nonnulls(negocio_id, suscripcion_id) <= 1);
create index idx_cobros_suscripcion on public.cobros (suscripcion_id) where suscripcion_id is not null;

alter table public.servicio_cobro_enrolamiento
  add column suscripcion_id uuid references public.suscripciones_producto(id);
alter table public.servicio_cobro_enrolamiento
  alter column negocio_id drop not null;
alter table public.servicio_cobro_enrolamiento
  add constraint servicio_cobro_enrolamiento_ancla check (num_nonnulls(negocio_id, suscripcion_id) = 1);


-- ── 5. Los Términos: documento y aceptación por suscripción ─────────────────────────────

alter table public.documentos_contractuales_versiones
  add column suscripcion_id uuid references public.suscripciones_producto(id);
alter table public.documentos_contractuales_versiones
  drop constraint documentos_versiones_empresa_coherente;
-- Un 'cliente' lleva los datos de UNA empresa: la del directorio (negocios) o la de una suscripción.
-- Un 'plantilla' no es de nadie.
alter table public.documentos_contractuales_versiones
  add constraint documentos_versiones_ancla_coherente check (
    (alcance = 'cliente' and num_nonnulls(empresa_id, suscripcion_id) = 1)
    or (alcance <> 'cliente' and empresa_id is null and suscripcion_id is null)
  );
-- El UNIQUE (workspace_id, slug, version, empresa_id) no cuenta los NULL: su gemelo por suscripción.
create unique index uq_documentos_versiones_suscripcion
  on public.documentos_contractuales_versiones (workspace_id, slug, version, suscripcion_id)
  where suscripcion_id is not null;

alter table public.aceptaciones_terminos
  add column suscripcion_id uuid references public.suscripciones_producto(id);
alter table public.aceptaciones_terminos
  add constraint aceptaciones_terminos_ancla check (num_nonnulls(negocio_id, suscripcion_id) <= 1);

-- Los dos canales que exigían negocio: ahora negocio o suscripción. Cuerpos de 20260917014500 y
-- 20261014203000 con esa sola línea cambiada.
alter table public.aceptaciones_terminos drop constraint aceptaciones_terminos_modulo_completa;
alter table public.aceptaciones_terminos
  add constraint aceptaciones_terminos_modulo_completa check (
    canal <> 'modulo'
    or (
      estado = 'aceptado'
      and calidad in ('representante_legal', 'apoderado')
      and num_nonnulls(negocio_id, suscripcion_id) = 1
      and usuario_id is not null
      and workspace_cliente_id is not null
      and documento_version_id is not null
      and cedula_aceptante is not null
      and texto_documento_sha256 is not null
      and texto_aceptacion_sha256 is not null
      and respondido_at is not null
      and nullif(btrim(empresa_nombre), '') is not null
      and nullif(btrim(empresa_nit), '') is not null
      and telefono is null
      and prompt_wamid is null
      and reply_wamid is null
      and button_id is null
      and payload_respuesta is null
      and enviado_at is null
    )
  );

alter table public.aceptaciones_terminos drop constraint aceptaciones_terminos_registro_completa;
alter table public.aceptaciones_terminos
  add constraint aceptaciones_terminos_registro_completa check (
    canal <> 'registro'
    or (
      estado = 'aceptado'
      and calidad = 'autorizado'
      and num_nonnulls(negocio_id, suscripcion_id) = 1
      and usuario_id is not null
      and workspace_cliente_id is not null
      and documento_version_id is not null
      and valida_registro_id is not null
      and texto_documento_sha256 is not null
      and texto_aceptacion_sha256 is not null
      and respondido_at is not null
      and nullif(btrim(empresa_nombre), '') is not null
      and nullif(btrim(empresa_nit), '') is not null
      and cedula_aceptante is null
      and telefono is null
      and prompt_wamid is null
      and reply_wamid is null
      and button_id is null
      and payload_respuesta is null
      and enviado_at is null
    )
  );

-- Gemelos por suscripción de los índices únicos por negocio (dos pestañas o dos corridas a la vez).
create unique index uq_aceptaciones_terminos_modulo_suscripcion
  on public.aceptaciones_terminos (suscripcion_id, documento_sha256)
  where canal = 'modulo' and estado = 'aceptado' and suscripcion_id is not null;
create unique index uq_aceptaciones_terminos_registro_suscripcion
  on public.aceptaciones_terminos (suscripcion_id, documento_sha256)
  where canal = 'registro' and estado = 'aceptado' and suscripcion_id is not null;
create index idx_aceptaciones_terminos_suscripcion
  on public.aceptaciones_terminos (suscripcion_id) where suscripcion_id is not null;

comment on column public.aceptaciones_terminos.suscripcion_id is
  'El contrato aceptado, cuando el cliente es una suscripción. Exactamente uno de negocio_id / suscripcion_id en los canales modulo y registro.';
