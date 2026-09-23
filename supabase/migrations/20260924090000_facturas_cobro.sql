-- ============================================================
-- 20260924090000 — La factura electrónica de un cobro de servicio, visible para el cliente
--
-- 4D SOFT no ve su factura FE-1 en su espacio de ONE. La factura existe (validada por la DIAN el
-- 2026-09-23) pero solo vive en `negocios.metadata.factura_electronica` y en Drive, y ninguna de las
-- dos cosas le llega al cliente: la metadata no sale nunca de las RPC cerradas del módulo (§3.6) y
-- un enlace de Drive no se le entrega al cliente (§5.4).
--
-- ## Qué escribe: DDL y funciones. Ni una fila de datos.
--
-- La fila de la FE-1 y su PDF en Storage los carga la sesión principal DESPUÉS de aplicar esto.
--
-- ## Por qué una tabla y no `cobros.factura` (jsonb) ni `cobros.factura_id`
--
--   * `cobros.factura_id` apunta a la tabla vieja `facturas`, que exige proyecto (0 filas, no sirve
--     para negocios).
--   * Una columna en `cobros` quedaría escribible por cualquier usuario del espacio cobrador con un
--     PATCH directo a PostgREST: `cobros` tiene `grant ... update ... to authenticated` (medido el
--     2026-09-23: `authenticated=arwdm`). Con eso se puede reapuntar la ruta del PDF que descarga un
--     cliente hacia otro archivo del bucket, por ejemplo el recibo de otro cliente. Es la misma razón
--     por la que `facturas_cuota` (20260924010000) no son columnas de `plan_cobro_cuotas`.
--   * `facturas_cobro` es hermana de `facturas_cuota`: misma forma, mismas guardas, sin grants a
--     `anon` ni a `authenticated`. La escribe solo el servidor (cliente de servicio) y el cliente la
--     lee solo por `mis_cobros_de_servicio()`. Se diferencian en a qué se cuelga la factura: una
--     cuota de un plan (los CDA, cada mes) o un cobro suelto (4D SOFT, un pago único).
--
-- ## El CUFE
--
-- El CUFE de la DIAN es un SHA-384 en hexadecimal: 96 caracteres, siempre. El CHECK lo exige para
-- que un CUFE mal copiado no se muestre como bueno. Ojo: el que hoy guarda
-- `negocios.metadata.factura_electronica.cufe` del negocio de 4D SOFT tiene 90 caracteres (medido el
-- 2026-09-23). Hay que sacar el correcto del XML de la factura (`<cbc:UUID schemeName="CUFE-SHA384">`)
-- antes de cargarla aquí; con el de la metadata el INSERT rebota, y eso es lo que se quiere.
--
-- ## `mis_cobros_de_servicio(uuid)` con la factura
--
-- Suma al final `factura_numero`, `factura_cufe`, `factura_fecha`, `factura_pdf_path` y
-- `factura_xml_path`. El resto del cuerpo es el de 20260916180000, igual (verificado contra
-- `pg_get_functiondef` de producción el 2026-09-23). Cambiar las columnas de salida de una función
-- `returns table` obliga a DROP + CREATE, y el DROP se lleva la ACL: se repone abajo.
--
-- ## Grants: `revoke from public` NO basta en este repo
--
-- Los privilegios por defecto del esquema `public` conceden EXECUTE sobre cada función nueva a
-- `anon` y `authenticated` por nombre, no a PUBLIC. Por eso la función se revoca nombrando a
-- `anon` y se concede a `authenticated` a propósito, y la tabla revoca a los tres.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select p.proname, pg_get_function_result(p.oid), p.prosecdef, p.proacl::text
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'mis_cobros_de_servicio';
--     -> prosecdef = true, proacl = {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--        (la que tenía antes del DROP, medida el 2026-09-23; SIN anon y SIN =X/ de PUBLIC)
--     -> el resultado termina en `factura_pdf_path text, factura_xml_path text`
--   select relrowsecurity, relacl::text from pg_class where oid = 'public.facturas_cobro'::regclass;
--     -> true, y la ACL sin anon ni authenticated
--   select count(*) from public.facturas_cobro;                                       -> 0
--
-- ## Cómo revertir (antes de cargar facturas)
--
--   drop function public.mis_cobros_de_servicio(uuid);
--   -- re-crearla con el cuerpo de 20260916180000 + revoke from public, anon + grant to authenticated
--   drop table public.facturas_cobro;
-- ============================================================


-- ── 1. La factura de un cobro ───────────────────────────────────────────────────────────

create table public.facturas_cobro (
  id uuid primary key default gen_random_uuid(),
  -- El cobrador (metrik), el mismo del cobro. Lo pone el servidor, nunca el navegador.
  workspace_id uuid not null references public.workspaces(id),
  -- Una factura por cobro. RESTRICT: borrar un cobro con su factura cargada perdería en silencio el
  -- rastro del documento fiscal que el cliente ya pudo descargar.
  cobro_id uuid not null unique references public.cobros(id) on delete restrict,
  numero text not null
    constraint facturas_cobro_numero check (numero ~ '^[A-Za-z0-9-]{1,40}$'),
  cufe text not null
    constraint facturas_cobro_cufe check (cufe ~ '^[0-9a-f]{96}$'),
  fecha_emision date not null,
  pdf_path text,
  pdf_sha256 text
    constraint facturas_cobro_pdf_sha check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  xml_path text,
  xml_sha256 text
    constraint facturas_cobro_xml_sha check (xml_sha256 is null or xml_sha256 ~ '^[0-9a-f]{64}$'),
  cargada_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Ruta y huella van juntas, y al menos uno de los dos archivos existe.
  constraint facturas_cobro_pdf_completo check ((pdf_path is null) = (pdf_sha256 is null)),
  constraint facturas_cobro_xml_completo check ((xml_path is null) = (xml_sha256 is null)),
  constraint facturas_cobro_algun_archivo check (pdf_path is not null or xml_path is not null)
);

alter table public.facturas_cobro enable row level security;
-- server-only: la escribe el servidor con el cliente de servicio; el cliente la lee solo por mis_cobros_de_servicio().
revoke all on table public.facturas_cobro from public, anon, authenticated;

comment on table public.facturas_cobro is
  'Factura electrónica (PDF y XML) de un cobro de servicio, en el bucket privado documentos-servicio. La escribe el servidor; el cliente pagador la ve y la descarga por mis_cobros_de_servicio() con URL firmada de 60 s. Hermana de facturas_cuota, que cuelga la factura de una cuota de un plan.';


-- ── 2. `mis_cobros_de_servicio(uuid)`, con la factura ───────────────────────────────────

drop function public.mis_cobros_de_servicio(uuid);

create function public.mis_cobros_de_servicio(p_servicio_contratado_id uuid)
returns table (
  cobro_id uuid,
  fecha date,
  concepto text,
  monto numeric,
  fuente text,
  estado text,
  recibo_numero text,
  recibo_origen text,
  recibo_path text,
  factura_numero text,
  factura_cufe text,
  factura_fecha date,
  factura_pdf_path text,
  factura_xml_path text
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
    nullif(c.siigo_recibo ->> 'storage_path', ''),
    f.numero,
    f.cufe,
    f.fecha_emision,
    f.pdf_path,
    f.xml_path
  from public.servicios_contratados sc
  join public.negocios n on n.id = sc.negocio_id
  join public.cobros c on c.negocio_id = sc.negocio_id
  -- La factura del cobro, si MeTRIK ya la cargó. Del mismo cobrador que el cobro.
  left join public.facturas_cobro f
    on f.cobro_id = c.id
   and f.workspace_id = c.workspace_id
  where sc.id = p_servicio_contratado_id
    and public.current_user_workspace_id() is not null
    -- Solo el pagador. Un beneficiario que no paga no tiene por qué ver el dinero de otro.
    and sc.workspace_pagador_id = public.current_user_workspace_id()
  order by c.fecha desc nulls last, c.created_at desc;
$$;

comment on function public.mis_cobros_de_servicio(uuid) is
  'Cobros del negocio de un servicio contratado, con su recibo y su factura electrónica, con lista cerrada de campos y solo para el workspace que paga. Nunca salen cobros.notas ni negocios.metadata.';

-- ejecutable-por-cliente: la invoca el servidor con el cliente de SESIÓN (pestañas Pagos de
-- /valida-api y /valida, y las rutas de descarga) y el filtro por workspace vive dentro.
revoke execute on function public.mis_cobros_de_servicio(uuid) from public, anon;
grant  execute on function public.mis_cobros_de_servicio(uuid) to authenticated;
