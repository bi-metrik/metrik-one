-- ============================================================
-- 20261014233000 — Factura electrónica automática por cada cobro aprobado (Aliaddo / Muisca)
--
-- Decisión de Mauricio (2026-10-14): los cobros automáticos se facturan con Aliaddo. Felipe
-- (`crecimiento-mrr/29-felipe-iva-suscripcion.md` §5): una factura electrónica validada por cada
-- cobro aprobado, el mismo día (Res. DIAN 165/2023, art. 5).
--
-- ## Qué escribe: DDL y funciones. Ni una fila de datos.
--
-- La numeración (prefijo, siguiente consecutivo, tope) la carga Mauricio DESPUÉS, cuando Aliaddo
-- tenga la resolución asociada (ver «Después de aplicar»). Sin esa fila nada se emite: la emisión
-- queda `bloqueada` y avisa.
--
-- ## Las piezas
--
--   1. `facturacion_numeracion`: el siguiente consecutivo por emisor, modo (Test / Habilitation /
--      Production) y tipo (factura / nota crédito). Muisca exige que ONE mande el consecutivo
--      (`consecutive` es obligatorio en POST /v2/documents/invoices), así que la numeración es de ONE.
--      Un modo no gasta los números de otro.
--   2. `facturas_electronicas`: una fila por documento, con su estado, su número, su CUFE, sus
--      archivos y los reintentos. `llave` única = una factura por pago aunque el webhook o el cron
--      se repitan (la pone el servidor: `factura:<cobro>:<modo>`).
--   3. `facturacion_asignar_consecutivo(uuid)`: le da a una emisión su número UNA vez, de forma
--      atómica (bloquea la fila y la numeración). Si ya tenía, devuelve el mismo: un reintento manda
--      el mismo número, como pide Muisca («No cambies automáticamente el prefijo o el consecutivo»).
--   4. `notificaciones.tipo` acepta 'factura_electronica' (el aviso al equipo cuando una emisión se
--      rechaza, se bloquea o no sale tras varios intentos). Se agrega a lo que haya, sin reescribir.
--
-- ## Por qué una tabla nueva y no `facturas_cobro`
--
-- `facturas_cobro` (20260924090000) es la factura YA emitida que ve el cliente: exige número, CUFE y
-- al menos un archivo. Aquí hace falta el antes: la cola, el número reservado, los reintentos, el
-- rechazo. Cuando una factura de Production queda archivada, el servidor la copia a `facturas_cobro`
-- y aparece en la pestaña Pagos de /valida-api sin tocar `mis_cobros_de_servicio`.
--
-- ## Seguridad
--
-- Las dos tablas son server-only (RLS encendida, sin grants a anon ni authenticated): las escribe el
-- servidor con la llave de servicio. La función solo la ejecuta service_role. Los privilegios por
-- defecto del esquema conceden EXECUTE a anon y authenticated POR NOMBRE: se revocan nombrándolos.
--
-- ## Después de aplicar (lo hace Mauricio, con la resolución ya asociada a Aliaddo)
--
--   -- Habilitación (el rango y el prefijo del set de pruebas que muestre Nitro / la DIAN):
--   insert into public.facturacion_numeracion (workspace_id, modo, tipo, prefijo, siguiente, hasta)
--   values ('<id de metrik>', 'Habilitation', 'factura', 'SETP', 990000001, 995000000);
--   -- Producción: el SIGUIENTE número libre de la resolución (si se reusa FE 1–1000, el siguiente al
--   -- último que emitió el facturador gratuito de la DIAN):
--   insert into public.facturacion_numeracion (workspace_id, modo, tipo, prefijo, siguiente, hasta)
--   values ('<id de metrik>', 'Production', 'factura', 'FE', <siguiente>, 1000);
--   insert into public.facturacion_numeracion (workspace_id, modo, tipo, prefijo, siguiente, hasta)
--   values ('<id de metrik>', 'Production', 'nota_credito', 'NC', 1, null);
--
-- ## Para reintentar una emisión rechazada o bloqueada (después de corregir la causa)
--
--   update public.facturas_electronicas
--      set estado = 'pendiente', alerta_motivo = null, proximo_intento_at = now()
--    where id = '<id>';
--   -- Conserva su número: se reenvía con el mismo consecutivo.
--
-- ## Verificación (solo lectura)
--
--   select relname, relrowsecurity, relacl::text from pg_class
--    where oid in ('public.facturacion_numeracion'::regclass, 'public.facturas_electronicas'::regclass);
--     -> rls true, ACL sin anon ni authenticated
--   select proacl::text from pg_proc where proname = 'facturacion_asignar_consecutivo';
--     -> solo postgres y service_role
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'notificaciones_tipo_check';
--     -> incluye 'factura_electronica'
--
-- ## Cómo revertir (antes de emitir la primera factura real)
--
--   drop function public.facturacion_asignar_consecutivo(uuid);
--   drop table public.facturas_electronicas;
--   drop table public.facturacion_numeracion;
--   -- 'factura_electronica' en notificaciones_tipo_check puede quedarse: no estorba.
-- ============================================================


-- ── 1. La numeración ───────────────────────────────────────────────────────────────────────

create table public.facturacion_numeracion (
  workspace_id uuid not null references public.workspaces(id),
  modo text not null
    constraint facturacion_numeracion_modo check (modo in ('Test', 'Habilitation', 'Production')),
  tipo text not null
    constraint facturacion_numeracion_tipo check (tipo in ('factura', 'nota_credito')),
  -- El de la resolución (Muisca: `prefix`, máximo 8).
  prefijo text not null
    constraint facturacion_numeracion_prefijo check (prefijo ~ '^[A-Z0-9]{1,8}$'),
  -- El próximo consecutivo que se entrega.
  siguiente bigint not null
    constraint facturacion_numeracion_siguiente check (siguiente > 0),
  -- El último autorizado por la resolución (inclusive). NULL = sin tope (notas crédito).
  hasta bigint
    constraint facturacion_numeracion_hasta check (hasta is null or hasta > 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, modo, tipo)
);

-- server-only: la consume solo facturacion_asignar_consecutivo() y la carga a mano quien asocia la resolución.
alter table public.facturacion_numeracion enable row level security;
revoke all on table public.facturacion_numeracion from public, anon, authenticated;

comment on table public.facturacion_numeracion is
  'Siguiente consecutivo de factura electrónica / nota crédito por emisor y modo de Aliaddo. La consume solo facturacion_asignar_consecutivo(). La carga a mano quien asocia la resolución.';


-- ── 2. Las emisiones ───────────────────────────────────────────────────────────────────────

create table public.facturas_electronicas (
  id uuid primary key default gen_random_uuid(),
  -- El emisor (el cobrador del cobro, hoy metrik).
  workspace_id uuid not null references public.workspaces(id),
  -- El pago que se factura. RESTRICT: un cobro con documento fiscal no se borra en silencio.
  cobro_id uuid not null references public.cobros(id) on delete restrict,
  tipo text not null
    constraint facturas_electronicas_tipo check (tipo in ('factura', 'nota_credito')),
  -- La factura que corrige una nota crédito.
  factura_origen_id uuid references public.facturas_electronicas(id) on delete restrict,
  -- Idempotencia: `factura:<cobro>:<modo>` o `nota:<origen>:<llave del llamador>`.
  llave text not null unique
    constraint facturas_electronicas_llave check (length(llave) between 10 and 200),
  proveedor text not null default 'aliaddo'
    constraint facturas_electronicas_proveedor check (proveedor in ('aliaddo')),
  modo text not null
    constraint facturas_electronicas_modo check (modo in ('Test', 'Habilitation', 'Production')),
  estado text not null default 'pendiente'
    constraint facturas_electronicas_estado check
      (estado in ('pendiente', 'enviada', 'emitida', 'archivada', 'rechazada', 'bloqueada')),
  -- Solo notas crédito: concepto de corrección (1-6 de la DIAN) y motivo en palabras.
  concepto_nota text
    constraint facturas_electronicas_concepto_nota check (concepto_nota is null or concepto_nota in ('1', '2', '3', '4', '5', '6')),
  motivo_nota text,
  monto_nota numeric
    constraint facturas_electronicas_monto_nota check (monto_nota is null or monto_nota > 0),

  prefijo text,
  consecutivo bigint
    constraint facturas_electronicas_consecutivo check (consecutivo is null or consecutivo > 0),
  numero text
    constraint facturas_electronicas_numero check (numero is null or numero ~ '^[A-Za-z0-9-]{1,40}$'),
  proveedor_documento_id text,
  -- CUFE (factura) o CUDE (nota): SHA-384 en hexadecimal, 96 caracteres.
  cufe text
    constraint facturas_electronicas_cufe check (cufe is null or cufe ~ '^[0-9a-f]{96}$'),
  fecha_emision date,

  pdf_path text,
  pdf_sha256 text
    constraint facturas_electronicas_pdf_sha check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  xml_path text,
  xml_sha256 text
    constraint facturas_electronicas_xml_sha check (xml_sha256 is null or xml_sha256 ~ '^[0-9a-f]{64}$'),

  intentos integer not null default 0
    constraint facturas_electronicas_intentos check (intentos >= 0),
  proximo_intento_at timestamptz not null default now(),
  -- Quién la está trabajando: un proceso la reclama por unos minutos.
  reclamada_hasta timestamptz,
  ultimo_error text,
  -- El último motivo por el que se avisó al equipo: se avisa una vez por motivo.
  alerta_motivo text,
  -- Lo último que se mandó y lo último que contestó Aliaddo (sin el token), para auditar.
  enviado jsonb,
  respuesta jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint facturas_electronicas_numeracion_junta check ((prefijo is null) = (consecutivo is null)),
  constraint facturas_electronicas_nota_con_origen check (
    (tipo = 'nota_credito') = (factura_origen_id is not null)
    and (tipo = 'nota_credito') = (concepto_nota is not null)
  ),
  constraint facturas_electronicas_emitida_completa check (
    estado not in ('emitida', 'archivada') or (cufe is not null and numero is not null and fecha_emision is not null)
  ),
  constraint facturas_electronicas_pdf_completo check ((pdf_path is null) = (pdf_sha256 is null)),
  constraint facturas_electronicas_xml_completo check ((xml_path is null) = (xml_sha256 is null))
);

-- Un número no se usa dos veces en el mismo emisor y modo.
create unique index facturas_electronicas_numero_unico
  on public.facturas_electronicas (workspace_id, modo, tipo, prefijo, consecutivo)
  where consecutivo is not null;

-- Lo que el cron recorre.
create index facturas_electronicas_por_trabajar
  on public.facturas_electronicas (modo, proximo_intento_at)
  where estado in ('pendiente', 'enviada', 'emitida');

create index facturas_electronicas_cobro on public.facturas_electronicas (cobro_id);

-- server-only: la escribe y la lee el servidor con la llave de servicio; el cliente ve su factura por facturas_cobro.
alter table public.facturas_electronicas enable row level security;
revoke all on table public.facturas_electronicas from public, anon, authenticated;

comment on table public.facturas_electronicas is
  'Factura electrónica (o nota crédito) de un cobro, emitida por Aliaddo: cola, número, CUFE, archivos y reintentos. Server-only. Una por pago y modo (llave). La de Production archivada se copia a facturas_cobro, que es la que ve el cliente.';


-- ── 3. El número, una vez ──────────────────────────────────────────────────────────────────

create function public.facturacion_asignar_consecutivo(p_emision_id uuid)
returns table (prefijo text, consecutivo bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e public.facturas_electronicas%rowtype;
  v_prefijo text;
  v_consecutivo bigint;
begin
  select * into v_e from public.facturas_electronicas where id = p_emision_id for update;
  if not found then
    raise exception 'emision_inexistente' using errcode = 'P0002';
  end if;

  -- Ya tenía número: el mismo, siempre.
  if v_e.consecutivo is not null then
    return query select v_e.prefijo, v_e.consecutivo;
    return;
  end if;

  update public.facturacion_numeracion n
     set siguiente = n.siguiente + 1,
         updated_at = now()
   where n.workspace_id = v_e.workspace_id
     and n.modo = v_e.modo
     and n.tipo = v_e.tipo
     and (n.hasta is null or n.siguiente <= n.hasta)
  returning n.prefijo, n.siguiente - 1 into v_prefijo, v_consecutivo;

  if v_consecutivo is null then
    if exists (
      select 1 from public.facturacion_numeracion n
       where n.workspace_id = v_e.workspace_id and n.modo = v_e.modo and n.tipo = v_e.tipo
    ) then
      raise exception 'rango_agotado' using errcode = 'P0001';
    end if;
    raise exception 'sin_numeracion' using errcode = 'P0001';
  end if;

  update public.facturas_electronicas
     set prefijo = v_prefijo,
         consecutivo = v_consecutivo,
         numero = v_prefijo || v_consecutivo::text,
         updated_at = now()
   where id = p_emision_id;

  return query select v_prefijo, v_consecutivo;
end;
$$;

comment on function public.facturacion_asignar_consecutivo(uuid) is
  'Le da a una emisión de facturas_electronicas su prefijo y consecutivo, una sola vez y de forma atómica. Si ya tenía, devuelve el mismo. Errores: sin_numeracion, rango_agotado.';

revoke execute on function public.facturacion_asignar_consecutivo(uuid) from public, anon, authenticated;
grant execute on function public.facturacion_asignar_consecutivo(uuid) to service_role;


-- ── 4. El aviso al equipo ──────────────────────────────────────────────────────────────────
--
-- Mismo método que 20261012150000: se agrega a lo que haya en la base, fallando si la forma no es
-- la esperada (nunca se reescribe la lista a ciegas).

do $$
declare
  v_def text;
  v_nueva text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'notificaciones_tipo_check' and conrelid = 'public.notificaciones'::regclass;
  if v_def is null then
    raise exception 'facturacion_electronica: no existe notificaciones_tipo_check; no se amplía a ciegas';
  end if;
  if position(quote_literal('factura_electronica') in v_def) > 0 then
    return;
  end if;
  v_nueva := regexp_replace(v_def, '\]\)\)\)$', format(', %s::text])))', quote_literal('factura_electronica')));
  if position(quote_literal('factura_electronica') in v_nueva) = 0 then
    raise exception 'facturacion_electronica: forma inesperada de notificaciones_tipo_check: %', v_def;
  end if;
  alter table public.notificaciones drop constraint notificaciones_tipo_check;
  execute format('alter table public.notificaciones add constraint notificaciones_tipo_check %s', v_nueva);
end $$;
