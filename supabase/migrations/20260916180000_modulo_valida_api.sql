-- ============================================================
-- 20260916180000 — Módulo Valida API en ONE (entrega C2)
-- Spec: proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md, §5.2 a §5.4 y §9.
--
-- Construye sobre A1 (`20260915210000_workspace_modulos`) y A2
-- (`20260916120000_catalogo_y_servicios_contratados`), las dos aplicadas en producción y
-- verificadas el 2026-09-16: las 6 tablas existen, el catálogo tiene las 4 fichas en v1 y
-- `servicios_contratados` está en 0 filas.
--
-- ## Qué escribe: DDL y funciones. Ni una fila de datos.
--
-- El workspace `4d-soft`, su fila en `workspace_modulos`, su servicio contratado y sus
-- usuarios son carga de datos en producción y NO están aquí: van con autorización explícita
-- de Mauricio, como manda §9.
--
-- ## Las cuatro piezas
--
--   1. `documentos_contractuales_versiones` — el texto y el PDF de cada versión de un
--      documento contractual, con su huella. Es lo que la pestaña Documentos muestra y lo
--      que ata una aceptación a lo que se aceptó (spec v2 §2.3, conservada por §5.6).
--   2. `documentos_aceptaciones_usuario` — la Política de Datos aceptada POR USUARIO en el
--      primer ingreso al módulo (§5.4). Reemplaza lo que hacía `portal_registrar_ingreso`.
--   3. Bucket privado `documentos-servicio` — los PDF que ve el cliente (recibos cargados a
--      mano). Nace sin políticas: SOLO el cliente de servicio lo toca y la descarga sale por
--      una URL firmada de 60 s desde el servidor. **Nunca un enlace de Drive** (§5.4): un
--      archivo «cualquiera con el enlace» no tiene control de acceso, y Google no está entre
--      los destinatarios de la Política de Valida.
--   4. Tres RPC `security definer` con lista CERRADA de campos: son la única vía por la que
--      el workspace de un cliente lee datos que viven en el workspace metrik (§3.6). Nunca
--      una policy sobre `negocios` o `cobros`, y nunca `negocios.metadata` (comisión,
--      promotora, notas de IVA) ni `cobros.notas`.
--
-- ## Por qué las RPC y no una vista
--
-- Un `create or replace view` borra `security_invoker` y ningún check de CI lo mira (§8).
-- Una función se declara una vez, su `search_path` queda fijo y su ACL se verifica con
-- `pg_proc.proacl`.
--
-- ## Por qué `security definer` y ejecutable por `authenticated`
--
-- Los datos que devuelven viven en el workspace metrik: con `invoker` la RLS del cliente los
-- taparía. El filtro lo hace la propia función con `current_user_workspace_id()`, así que el
-- guard del server action no es lo que protege (esa distinción ya costó caro en este repo) y
-- la función es segura aunque el navegador la llame directo por PostgREST.
--
-- ⚠️ Mientras `servicios_contratados` esté vacía las tres devuelven CERO filas. Es correcto:
-- sin contrato cargado (A3) este workspace no tiene nada contratado que mostrar, y una
-- pantalla que inventara un estado sería peor que una vacía.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select relname, relrowsecurity from pg_class
--    where relnamespace = 'public'::regnamespace
--      and relname in ('documentos_contractuales_versiones','documentos_aceptaciones_usuario');
--     -> las 2 con relrowsecurity = true
--   select t.relname,
--          has_table_privilege('anon', t.oid, 'select')          as anon,
--          has_table_privilege('authenticated', t.oid, 'select') as auth
--     from pg_class t
--    where t.relnamespace = 'public'::regnamespace
--      and t.relname in ('documentos_contractuales_versiones','documentos_aceptaciones_usuario');
--     -> anon y auth en false en las 2
--   select p.proname, p.proacl from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('mis_servicios','mis_cobros_de_servicio','mis_documentos_de_servicio');
--     -> las 3 con authenticated=X y SIN anon ni =X/ (PUBLIC)
--   select id, public from storage.buckets where id = 'documentos-servicio';  -> public = false
--   select count(*) from public.documentos_contractuales_versiones;           -> 0
-- ============================================================

-- ── 1. Versiones de documentos contractuales ─────────────────────────────────

-- server-only: la lee el servidor y la RPC `mis_documentos_de_servicio`. El cliente nunca
-- la consulta directo.
create table public.documentos_contractuales_versiones (
  id uuid primary key default gen_random_uuid(),

  -- El workspace del COBRADOR (metrik): el documento es de MeTRIK, no del cliente.
  workspace_id uuid not null references public.workspaces(id),
  -- La línea a la que pertenece (Valida). Null = transversal.
  linea_id uuid references public.lineas_negocio(id),

  slug text not null
    constraint documentos_versiones_slug_no_vacio check (length(trim(slug)) between 1 and 80),
  alcance text not null
    constraint documentos_versiones_alcance check (alcance in ('plantilla', 'cliente')),
  -- Los términos de 4D SOFT llevan sus datos, así que son de alcance 'cliente'. Un alcance
  -- 'cliente' sin empresa no identifica a nadie y un 'plantilla' con empresa se contradice:
  -- el CHECK exige la correspondencia en LAS DOS direcciones.
  empresa_id uuid references public.empresas(id),
  constraint documentos_versiones_empresa_coherente
    check ((alcance = 'cliente') = (empresa_id is not null)),

  titulo text not null,
  version text not null,

  -- Exactamente el texto del PDF, sin notas internas. El PDF es la evidencia; esto es la
  -- forma cómoda de leerlo, y por eso la constancia dice cuál de los dos se aceptó.
  texto_md text not null,
  texto_sha256 text not null
    constraint documentos_versiones_texto_sha check (texto_sha256 ~ '^[0-9a-f]{64}$'),

  pdf_bucket text not null default 'aceptaciones-documentos',
  pdf_path text not null,
  -- La llave con la que una aceptación se ata a lo aceptado:
  -- `aceptaciones_terminos.documento_sha256 = pdf_sha256`.
  pdf_sha256 text not null unique
    constraint documentos_versiones_pdf_sha check (pdf_sha256 ~ '^[0-9a-f]{64}$'),

  vigente_desde date not null,
  vigente_hasta date,

  registrado_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),

  constraint documentos_versiones_slug_version unique (workspace_id, slug, version, empresa_id)
);

alter table public.documentos_contractuales_versiones enable row level security;
revoke all on table public.documentos_contractuales_versiones from public, anon, authenticated;

create index idx_documentos_versiones_empresa on public.documentos_contractuales_versiones (empresa_id);
create index idx_documentos_versiones_slug on public.documentos_contractuales_versiones (slug, version);

comment on table public.documentos_contractuales_versiones is
  'Una fila por versión de un documento contractual: el texto web canónico, el PDF en bucket privado y las dos huellas. Se ata a su aceptación por pdf_sha256.';
comment on column public.documentos_contractuales_versiones.pdf_sha256 is
  'Huella del PDF. Es la llave contra aceptaciones_terminos.documento_sha256: la URL firmada de esa tabla vence y no sirve como vínculo.';

-- Una versión firmada no se reescribe: si cambia el texto, es otra versión. Solo
-- `vigente_hasta` se puede mover, que es retirarla de circulación sin negar que existió.
create or replace function public.documentos_versiones_inmutables()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'documentos_contractuales_versiones es inmutable: una versión aceptada no se borra';
  end if;
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.slug is distinct from old.slug
     or new.version is distinct from old.version
     or new.empresa_id is distinct from old.empresa_id
     or new.texto_md is distinct from old.texto_md
     or new.texto_sha256 is distinct from old.texto_sha256
     or new.pdf_bucket is distinct from old.pdf_bucket
     or new.pdf_path is distinct from old.pdf_path
     or new.pdf_sha256 is distinct from old.pdf_sha256
     or new.vigente_desde is distinct from old.vigente_desde then
    raise exception 'documentos_contractuales_versiones es inmutable salvo vigente_hasta: suba una versión nueva';
  end if;
  return new;
end;
$$;

revoke execute on function public.documentos_versiones_inmutables() from public, anon, authenticated;

create trigger trg_documentos_versiones_inmutables
  before update or delete on public.documentos_contractuales_versiones
  for each row execute function public.documentos_versiones_inmutables();

-- ── 2. Aceptación de la Política de Datos, por usuario ───────────────────────

-- server-only. La escribe el servidor con el cliente de servicio en el primer ingreso al
-- módulo y la lee la misma vía: no hay policy porque el cliente nunca la consulta.
create table public.documentos_aceptaciones_usuario (
  id uuid primary key default gen_random_uuid(),

  workspace_id uuid not null references public.workspaces(id),
  usuario_id uuid not null references public.profiles(id),

  -- 'politica-datos-valida' hoy. Se guarda el slug para que el mismo registro sirva a otro
  -- documento sin otra tabla.
  documento_slug text not null
    constraint aceptaciones_usuario_slug check (length(trim(documento_slug)) between 1 and 80),
  documento_version text not null,
  -- Huella del PDF de la Política, cuando exista uno fijo. Hoy Valida la publica como página
  -- (`/recursos/privacidad`) y su PDF se genera al vuelo, así que no hay un archivo estable que
  -- hashear: va null, igual que en el portal v1, que anclaba solo por versión.
  documento_sha256 text
    constraint aceptaciones_usuario_sha
      check (documento_sha256 is null or documento_sha256 ~ '^[0-9a-f]{64}$'),
  documento_url text,
  -- Lo que SÍ es fijo: el texto exacto del aviso que la persona leyó junto a la casilla. La
  -- autorización se da por conducta inequívoca (Decreto 1377 de 2013, art. 8) y su prueba es
  -- qué se le dijo; sin esta huella, «aceptó la v1.4» no se puede reconstruir.
  aviso_texto_sha256 text not null
    constraint aceptaciones_usuario_aviso_sha check (aviso_texto_sha256 ~ '^[0-9a-f]{64}$'),

  aceptada_at timestamptz not null default now(),
  ip inet,
  user_agent text,

  -- Una aceptación por usuario y versión: reentrar no crea filas nuevas, y aceptar una
  -- versión nueva sí, porque es otro consentimiento.
  constraint aceptaciones_usuario_unica unique (usuario_id, documento_slug, documento_version)
);

alter table public.documentos_aceptaciones_usuario enable row level security;
revoke all on table public.documentos_aceptaciones_usuario from public, anon, authenticated;

create index idx_aceptaciones_usuario_ws on public.documentos_aceptaciones_usuario (workspace_id, documento_slug);

comment on table public.documentos_aceptaciones_usuario is
  'Política de Datos aceptada por usuario en el primer ingreso al módulo Valida API (§5.4). Reemplaza a portal_registrar_ingreso del portal v1.';

-- ── 3. Bucket privado de los PDF que ve el cliente ──────────────────────────

-- Sin políticas de storage a propósito: solo el cliente de servicio escribe y firma. La
-- descarga sale de una ruta de servidor que comprueba la sesión y devuelve una URL firmada
-- de 60 s. `ve-documentos` no sirve para esto: es público.
insert into storage.buckets (id, name, public)
values ('documentos-servicio', 'documentos-servicio', false)
on conflict (id) do nothing;

-- ── 4. Lo que el cliente puede leer del workspace del cobrador ──────────────

-- Servicios contratados que cubren al workspace de la sesión: como pagador o como
-- beneficiario. Lista CERRADA de campos: nunca sale la comisión, ni el negocio, ni la
-- empresa del cobrador.
create or replace function public.mis_servicios()
returns table (
  servicio_contratado_id uuid,
  servicio_slug text,
  servicio_nombre text,
  servicio_version integer,
  modulo text,
  disparador_cobro text,
  estado text,
  vigente_desde date,
  vigente_hasta date,
  es_pagador boolean,
  negocio_nombre text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    sc.id,
    sc.servicio_slug,
    cs.nombre,
    sc.servicio_version,
    cs.modulo,
    cs.disparador_cobro,
    sc.estado,
    sc.vigente_desde,
    sc.vigente_hasta,
    -- `coalesce` porque un contrato que paga MeTRIK tiene `workspace_pagador_id` NULL, y
    -- `NULL = uuid` da NULL, no false. Visto al correr la migración: el beneficiario salía
    -- con `es_pagador` en NULL en vez de false.
    coalesce(sc.workspace_pagador_id = public.current_user_workspace_id(), false) as es_pagador,
    n.nombre
  from public.servicios_contratados sc
  join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
  join public.negocios n on n.id = sc.negocio_id
  where public.current_user_workspace_id() is not null
    and (
      sc.workspace_pagador_id = public.current_user_workspace_id()
      or exists (
        select 1 from public.servicio_contratado_beneficiarios b
        where b.servicio_contratado_id = sc.id
          and b.workspace_id = public.current_user_workspace_id()
      )
    )
  order by sc.vigente_desde desc, cs.nombre;
$$;

comment on function public.mis_servicios() is
  'Los servicios que cubren al workspace de la sesión, con lista cerrada de campos. Única vía por la que un cliente lee servicios_contratados, que vive en el workspace del cobrador (§3.6).';

-- ejecutable-por-cliente: la invoca el navegador vía server action y filtra por
-- current_user_workspace_id() dentro de la propia función, no en el guard del action.
revoke execute on function public.mis_servicios() from public, anon;
grant  execute on function public.mis_servicios() to authenticated;

-- Cobros de UN servicio contratado. Solo quien PAGA ve la plata: un beneficiario que no
-- paga ve qué módulo tiene y hasta cuándo, sin precio (§3.6).
create or replace function public.mis_cobros_de_servicio(p_servicio_contratado_id uuid)
returns table (
  cobro_id uuid,
  fecha date,
  concepto text,
  monto numeric,
  fuente text,
  estado text,
  recibo_numero text,
  recibo_origen text,
  recibo_path text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    c.fecha,
    n.nombre,
    -- Un cobro anulado vale 0 en `monto` desde el 2026-08-11 y su valor vive en
    -- `monto_anulado`: mostrar el 0 sin decir que está anulado sería mentir por omisión.
    coalesce(nullif(c.monto, 0), c.monto_anulado, c.monto),
    c.fuente,
    case
      when c.anulado_at is not null then 'anulado'
      when c.fecha is null then 'programado'
      else 'pagado'
    end,
    nullif(c.siigo_recibo ->> 'numero', ''),
    nullif(c.siigo_recibo ->> 'origen', ''),
    nullif(c.siigo_recibo ->> 'storage_path', '')
  from public.servicios_contratados sc
  join public.negocios n on n.id = sc.negocio_id
  join public.cobros c on c.negocio_id = sc.negocio_id
  where sc.id = p_servicio_contratado_id
    and public.current_user_workspace_id() is not null
    -- Solo el pagador. Un beneficiario que no paga no tiene por qué ver el dinero de otro.
    and sc.workspace_pagador_id = public.current_user_workspace_id()
  order by c.fecha desc nulls last, c.created_at desc;
$$;

comment on function public.mis_cobros_de_servicio(uuid) is
  'Cobros del negocio de un servicio contratado, con lista cerrada de campos y solo para el workspace que paga. Nunca salen cobros.notas ni negocios.metadata.';

-- ejecutable-por-cliente: misma razón que mis_servicios(); el filtro por workspace vive
-- dentro de la función.
revoke execute on function public.mis_cobros_de_servicio(uuid) from public, anon;
grant  execute on function public.mis_cobros_de_servicio(uuid) to authenticated;

-- Documentos contractuales del cliente: los de su empresa más las plantillas de la línea del
-- servicio, con la constancia de su aceptación cuando existe.
create or replace function public.mis_documentos_de_servicio()
returns table (
  documento_id uuid,
  slug text,
  titulo text,
  version text,
  alcance text,
  texto_md text,
  pdf_bucket text,
  pdf_path text,
  pdf_sha256 text,
  vigente_desde date,
  vigente_hasta date,
  aceptado_at timestamptz,
  aceptado_por text,
  aceptado_calidad text,
  aceptado_canal text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mios as (
    -- `distinct`: un cliente con dos contratos de la misma empresa (uno que paga y otro del
    -- que es beneficiario) duplicaba cada documento. Visto al correr la migración.
    select distinct sc.empresa_id
    from public.servicios_contratados sc
    where public.current_user_workspace_id() is not null
      and (
        sc.workspace_pagador_id = public.current_user_workspace_id()
        or exists (
          select 1 from public.servicio_contratado_beneficiarios b
          where b.servicio_contratado_id = sc.id
            and b.workspace_id = public.current_user_workspace_id()
        )
      )
  )
  select
    d.id,
    d.slug,
    d.titulo,
    d.version,
    d.alcance,
    d.texto_md,
    d.pdf_bucket,
    d.pdf_path,
    d.pdf_sha256,
    d.vigente_desde,
    d.vigente_hasta,
    a.created_at,
    a.nombre_aceptante,
    a.calidad,
    -- El canal se nombra porque cambia lo que la constancia demuestra: por WhatsApp la
    -- v1.0 descansa en un webhook cuya firma no se verifica (§8, riesgo preexistente).
    case when a.prompt_wamid is not null then 'whatsapp' else 'modulo' end
  from public.documentos_contractuales_versiones d
  join mios m on m.empresa_id = d.empresa_id
  left join public.aceptaciones_terminos a
    on a.documento_sha256 = d.pdf_sha256
   and a.estado = 'aceptado'
  order by d.slug, d.vigente_desde desc;
$$;

comment on function public.mis_documentos_de_servicio() is
  'Documentos contractuales de la empresa del cliente con la constancia de su aceptación. Nunca salen el teléfono, el wamid ni el payload de Meta: se quedan en ONE como evidencia.';

-- ejecutable-por-cliente: el filtro por workspace vive dentro de la función.
revoke execute on function public.mis_documentos_de_servicio() from public, anon;
grant  execute on function public.mis_documentos_de_servicio() to authenticated;
