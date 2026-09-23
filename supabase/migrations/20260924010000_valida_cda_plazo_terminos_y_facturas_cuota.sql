-- ============================================================
-- 20260924010000 — Valida de los CDA: plazo para aceptar los términos y facturas de cada cuota
--
-- Continúa `20260923220000_terminos_cda_designado_y_enlace_pago.sql` (PR #845). Dos decisiones de
-- Mauricio del 2026-09-23:
--
--   1. PLAZO DE GRACIA. Hasta una fecha por contrato, el CDA opera Valida aunque la persona
--      designada no haya aceptado todavía; ve un aviso y ella puede aceptar desde ahí. Desde el día
--      siguiente, sin aceptación, Valida se pausa como hoy. NULL = sin plazo: se pausa de inmediato
--      (el comportamiento del #845, que no cambia para nadie mientras nadie cargue la fecha).
--
--   2. FACTURAS DE CADA CUOTA. MeTRIK sube cada mes la factura electrónica (PDF y XML) de la cuota y
--      el CDA la descarga desde la pestaña Pagos de /valida, con el mismo mecanismo de los recibos de
--      4D SOFT: bucket privado `documentos-servicio`, URL firmada de 60 s, y la autorización es la
--      MISMA RPC que lista (`mis_cuotas_de_servicio`).
--
-- ## Qué escribe: DDL y funciones. Ni una fila de datos.
--
-- La fecha del plazo de cada CDA va en `sql/valida-cda/2026-09-23_contratos-y-terminos-cdas.sql`
-- (la aplica la sesión principal). Hoy no hay ningún contrato de Valida de un CDA cargado.
--
-- ## Las cuatro piezas
--
--   1. `servicios_contratados.terminos_plazo_hasta date` — último día (inclusive, hora Bogotá) en
--      que el espacio opera sin la aceptación.
--   2. `mis_servicios()` devuelve además `terminos_plazo_hasta`. Es una fecha del contrato que ya
--      ve el espacio (pagador o beneficiario): no abre plata ni datos de otro cliente. Cambiar la
--      lista de columnas de una función `returns table` obliga a DROP + CREATE (Postgres no deja
--      cambiar el tipo de salida con `create or replace`), y el DROP se lleva la ACL: se repone.
--   3. `facturas_cuota` — una fila por cuota de `plan_cobro_cuotas` con el número de la factura y
--      las rutas y huellas de su PDF y su XML. Sin grants a `anon` ni a `authenticated`: la escribe
--      solo el servidor (cliente de servicio) después de comprobar que quien carga es dueño o
--      administrador del espacio cobrador, y el cliente la lee solo por la RPC.
--      NO va como columnas de `plan_cobro_cuotas` porque esa tabla tiene `grant ... update ... to
--      authenticated` con RLS por espacio: cualquier usuario de metrik podría reescribir la ruta del
--      PDF que descarga un cliente con un PATCH a PostgREST.
--   4. `mis_cuotas_de_servicio(uuid)` devuelve además el id de la cuota y la factura (número y rutas
--      de sus dos archivos). Mismo cuerpo, mismo filtro (solo el pagador). DROP + CREATE por la
--      misma razón que (2); su único consumidor es ONE (`src/lib/valida-cda/pago-servidor.ts`).
--
-- ## Grants: `revoke from public` NO basta en este repo
--
-- Los privilegios por defecto del esquema `public` (medido el 2026-09-23 en `pg_default_acl`, para
-- postgres y supabase_admin) conceden EXECUTE sobre cada función nueva a `anon` y `authenticated`
-- por nombre, no a PUBLIC. Por eso cada función se revoca nombrando a `anon` y se concede a
-- `authenticated` a propósito, y la tabla revoca a los tres.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'servicios_contratados'
--      and column_name = 'terminos_plazo_hasta';                                    -> 1 fila
--   select p.proname, pg_get_function_result(p.oid), p.prosecdef, p.proacl::text
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in ('mis_servicios', 'mis_cuotas_de_servicio');
--     -> las dos: prosecdef = true y proacl = {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--        (SIN anon y SIN =X/ de PUBLIC; es la ACL que tenían antes del DROP, medida el 2026-09-23)
--     -> mis_servicios termina en `negocio_nombre text, terminos_plazo_hasta date`
--     -> mis_cuotas_de_servicio empieza por `cuota_id uuid` y termina en `factura_xml_path text`
--   select relrowsecurity, relacl::text from pg_class where oid = 'public.facturas_cuota'::regclass;
--     -> true, y la ACL sin anon ni authenticated
--   select count(*) from public.facturas_cuota;                                        -> 0
--
-- ## Cómo revertir (antes de cargar plazos o facturas)
--
--   drop table public.facturas_cuota;
--   -- re-crear mis_cuotas_de_servicio con el cuerpo de 20260923220000 (drop + create + grants)
--   -- re-crear mis_servicios con el cuerpo de 20260916180000 (drop + create + grants)
--   alter table public.servicios_contratados drop column terminos_plazo_hasta;
-- ============================================================


-- ── 1. El plazo para aceptar ────────────────────────────────────────────────────────────

alter table public.servicios_contratados
  add column terminos_plazo_hasta date;

comment on column public.servicios_contratados.terminos_plazo_hasta is
  'Último día (inclusive, hora Bogotá) en que el espacio del cliente opera el módulo sin la aceptación de sus términos. Mientras tanto ve un aviso; desde el día siguiente, sin aceptación, el módulo se pausa. NULL = sin plazo: se pausa desde que el contrato existe.';


-- ── 2. `mis_servicios()`, con el plazo ──────────────────────────────────────────────────
--
-- Cuerpo de 20260916180000 con UNA columna más al final. Nadie depende de la función en la base
-- (medido en `pg_depend` el 2026-09-23), así que el DROP no arrastra nada.

drop function public.mis_servicios();

create function public.mis_servicios()
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
  negocio_nombre text,
  terminos_plazo_hasta date
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
    -- `NULL = uuid` da NULL, no false.
    coalesce(sc.workspace_pagador_id = public.current_user_workspace_id(), false) as es_pagador,
    n.nombre,
    sc.terminos_plazo_hasta
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
  'Los servicios que cubren al workspace de la sesión, con lista cerrada de campos (incluido el plazo para aceptar los términos). Única vía por la que un cliente lee servicios_contratados, que vive en el workspace del cobrador (§3.6).';

-- ejecutable-por-cliente: la invoca el servidor con el cliente de SESIÓN (puerta de /valida y
-- módulo Valida API) y filtra por current_user_workspace_id() dentro de la propia función.
revoke execute on function public.mis_servicios() from public, anon;
grant  execute on function public.mis_servicios() to authenticated;


-- ── 3. Las facturas de cada cuota ───────────────────────────────────────────────────────

create table public.facturas_cuota (
  id uuid primary key default gen_random_uuid(),
  -- El cobrador (metrik). Lo pone el servidor desde la cuota, nunca el navegador.
  workspace_id uuid not null references public.workspaces(id),
  -- Una factura por cuota. RESTRICT: borrar una cuota con su factura cargada perdería en silencio
  -- el rastro del documento fiscal que el cliente ya pudo descargar.
  plan_cobro_cuota_id uuid not null unique references public.plan_cobro_cuotas(id) on delete restrict,
  numero text not null
    constraint facturas_cuota_numero check (numero ~ '^[A-Za-z0-9-]{1,40}$'),
  pdf_path text,
  pdf_sha256 text
    constraint facturas_cuota_pdf_sha check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  xml_path text,
  xml_sha256 text
    constraint facturas_cuota_xml_sha check (xml_sha256 is null or xml_sha256 ~ '^[0-9a-f]{64}$'),
  cargada_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Ruta y huella van juntas, y al menos uno de los dos archivos existe.
  constraint facturas_cuota_pdf_completo check ((pdf_path is null) = (pdf_sha256 is null)),
  constraint facturas_cuota_xml_completo check ((xml_path is null) = (xml_sha256 is null)),
  constraint facturas_cuota_algun_archivo check (pdf_path is not null or xml_path is not null)
);

alter table public.facturas_cuota enable row level security;
-- server-only: la escribe el servidor con el cliente de servicio tras exigir dueño o administrador del espacio cobrador; el cliente la lee solo por mis_cuotas_de_servicio().
revoke all on table public.facturas_cuota from public, anon, authenticated;

comment on table public.facturas_cuota is
  'Factura electrónica (PDF y XML) de una cuota de plan_cobro_cuotas, en el bucket privado documentos-servicio. La escribe el servidor; el cliente pagador la ve y la descarga por mis_cuotas_de_servicio() con URL firmada de 60 s.';


-- ── 4. `mis_cuotas_de_servicio(uuid)`, con la cuota y su factura ────────────────────────

drop function public.mis_cuotas_de_servicio(uuid);

create function public.mis_cuotas_de_servicio(p_servicio_contratado_id uuid)
returns table (
  cuota_id uuid,
  numero integer,
  tipo text,
  monto numeric,
  fecha_vencimiento date,
  concepto text,
  enlace_pago_url text,
  enlace_pago_expira timestamptz,
  factura_numero text,
  factura_pdf_path text,
  factura_xml_path text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    q.id,
    q.numero,
    q.tipo,
    q.monto,
    q.fecha_vencimiento,
    q.concepto_detalle,
    c.enlace_pago_url,
    c.enlace_pago_expira,
    f.numero,
    f.pdf_path,
    f.xml_path
  from public.servicios_contratados sc
  -- Los planes del negocio del contrato, en el workspace del cobrador, encendidos o no.
  join public.planes_cobro p
    on p.negocio_id = sc.negocio_id
   and p.workspace_id = sc.workspace_id
  join public.plan_cobro_cuotas q on q.plan_cobro_id = p.id
  -- El enlace vive en el cobro programado de ESA cuota; uno anulado no ofrece enlace.
  left join public.cobros c
    on c.plan_cobro_id = p.id
   and c.numero_cuota = q.numero
   and c.anulado_at is null
  -- La factura de la cuota, si MeTRIK ya la cargó. Del mismo cobrador que el contrato.
  left join public.facturas_cuota f
    on f.plan_cobro_cuota_id = q.id
   and f.workspace_id = sc.workspace_id
  where sc.id = p_servicio_contratado_id
    and public.current_user_workspace_id() is not null
    -- Solo el pagador, igual que `mis_cobros_de_servicio`.
    and sc.workspace_pagador_id = public.current_user_workspace_id()
  order by q.fecha_vencimiento, q.numero;
$$;

comment on function public.mis_cuotas_de_servicio(uuid) is
  'Cuotas del contrato (monto, vencimiento, período) con el enlace de pago de su cobro programado y su factura electrónica, con lista cerrada de campos y solo para el workspace que paga. Nunca salen las notas del plan, las del cobro ni negocios.metadata.';

-- ejecutable-por-cliente: la invoca el servidor con el cliente de SESIÓN (tarjeta y pestaña de
-- pagos de /valida, y la ruta de descarga de facturas) y el filtro por workspace vive dentro.
revoke execute on function public.mis_cuotas_de_servicio(uuid) from public, anon;
grant  execute on function public.mis_cuotas_de_servicio(uuid) to authenticated;
