-- ============================================================
-- 20260924100000 — Retención de IVA del cliente sobre las cuotas que cobra MeTRIK
--
-- Decisión de Carmen y Felipe (acta 2026-09-23, sección A, en
-- proyectos/metrik/one/docs/2026-09-23_reunion-retencion-iva-tarifa-simple.md): METRIK IA S.A.S. es
-- del SIMPLE y responsable de IVA, así que un cliente responsable de IVA le retiene el 15% del IVA
-- de cada servicio gravado (ET 437-2 num. 9 y 437-1). En una cuota de $2.380.000 (base 2.000.000 +
-- IVA 380.000) retiene $57.000 y paga $2.323.000. El enlace de pago va por el NETO; la factura sigue
-- por el total; y el cobro no puede quedar con $57.000 de saldo: la diferencia es una retención de
-- IVA con el certificado por llegar.
--
-- Es operación interna del espacio de MeTRIK como cobrador. Ningún espacio la activa si no declara
-- `workspaces.config_extra.cobros.retencion_iva_pagador_pct` (dato, no código); ver
-- `src/lib/cobros/retencion-iva.ts`.
--
-- ## Qué escribe: DDL y una función. Ni una fila de datos.
--
-- Las columnas nacen en 0 / NULL, que es exactamente el comportamiento de hoy: ninguna cuota tiene
-- IVA declarado y ningún cobro tiene retención. El IVA de cada cuota y la configuración del espacio
-- los carga la sesión principal DESPUÉS de aplicar esto (SQL en el cuerpo del PR).
--
-- ## 1. `plan_cobro_cuotas.iva`: cuánto IVA lleva la cuota
--
-- El monto de la cuota es el TOTAL de la factura (precio de lista con IVA incluido, decisión
-- 2026-06-30). `iva` es la parte de ese total que es IVA. 0 = cuota no gravada, excluida, o emitida
-- por quien no cobra IVA: el enlace sale por el total, sin retención. Se guarda el valor y no una
-- tarifa porque tiene que ser el MISMO número de la factura electrónica, con su redondeo.
--
-- ## 2. La retención en el cobro: columnas en `cobros`, no `split_json` ni una tabla
--
--   * `split_json` es el reparto que propone el comercial entre negocios (#738, con su
--     `confirmado_at`). La retención no es una porción de un reparto: es cuánto del cobro NO entró
--     en efectivo. Meterla ahí obligaría a cada suma de saldo a abrir un jsonb sin CHECK.
--   * `cobros.retencion` ya existe, pero es una suma plana sin estado (retefuente + reteica de
--     SOENA) y nadie la cuenta para el saldo. Se sigue llenando con el total retenido (la vista de
--     revisión y el cruce con Siigo la leen), y `retencion_iva` es la parte de IVA que SÍ cuenta
--     para el saldo, con su certificado.
--   * Una tabla aparte obligaría a un join en cada lectura del reparto FIFO de cuotas (tres
--     lectores, uno de ellos la RPC de abajo). Son cuatro columnas del mismo hecho: el cobro.
--
-- `monto` sigue siendo la plata que entró (2.323.000): es lo que concilia contra el banco y lo que
-- cruza Siigo. Lo que el cobro CUBRE de la cuota es `monto + retencion_iva`.
--
-- ## Grants
--
-- No hay tablas nuevas. Las columnas heredan los grants de sus tablas: `cobros` y
-- `plan_cobro_cuotas` tienen update para `authenticated` bajo RLS por espacio, así que un usuario
-- del espacio cobrador puede editarlas por PostgREST, igual que ya puede editar `monto`. No abre
-- nada hacia otro espacio. El cliente pagador (otro espacio) solo ve `retencion_iva` por la RPC.
--
-- ## 3. `mis_cobros_de_servicio(uuid)` con la retención
--
-- Suma al final `retencion_iva`, para que la pestaña Pagos del cliente reparta lo que cubrió cada
-- cobro (efectivo + retención) y no le muestre $57.000 de deuda. El resto del cuerpo es el de
-- 20260924090000, igual. Cambiar las columnas de salida de una función `returns table` obliga a
-- DROP + CREATE, y el DROP se lleva la ACL: se repone abajo nombrando a `anon` (en este repo
-- `revoke from public` no le quita nada a `anon` ni a `authenticated`: sus EXECUTE vienen de los
-- privilegios por defecto del esquema, por nombre).
--
-- ⚠️ Antes de aplicar: comparar el cuerpo de abajo con `pg_get_functiondef` de producción. Si
-- alguien cambió la función después de 20260924090000, hay que re-aplicar ese cambio aquí.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and ((table_name = 'cobros' and column_name like 'retencion_iva%')
--        or (table_name = 'plan_cobro_cuotas' and column_name = 'iva'));
--     -> 5 filas; iva y retencion_iva NOT NULL default 0
--   select count(*) from public.cobros where retencion_iva <> 0 or retencion_iva_estado is not null;  -> 0
--   select p.proacl::text, pg_get_function_result(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'mis_cobros_de_servicio';
--     -> {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--        y el resultado termina en `factura_xml_path text, retencion_iva numeric`
--
-- ## Cómo revertir (antes de cargar datos)
--
--   drop function public.mis_cobros_de_servicio(uuid);
--   -- re-crearla con el cuerpo de 20260924090000 + revoke from public, anon + grant to authenticated
--   alter table public.cobros
--     drop column retencion_iva_certificado_soporte, drop column retencion_iva_certificado_fecha,
--     drop column retencion_iva_estado, drop column retencion_iva;
--   alter table public.plan_cobro_cuotas drop column iva;
-- ============================================================


-- ── 1. El IVA de la cuota ───────────────────────────────────────────────────────────────

alter table public.plan_cobro_cuotas
  add column iva numeric(15,2) not null default 0;

alter table public.plan_cobro_cuotas
  add constraint plan_cobro_cuotas_iva_rango check (iva >= 0 and iva < monto);

comment on column public.plan_cobro_cuotas.iva is
  'IVA incluido en `monto` (el monto es el total de la factura). 0 = cuota no gravada o excluida. Si es > 0 y el pagador es responsable de IVA (empresas.responsable_iva), el enlace de pago sale por monto − la retención de IVA que practica el cliente. Ver src/lib/cobros/retencion-iva.ts.';


-- ── 2. La retención de IVA en el cobro ──────────────────────────────────────────────────

alter table public.cobros
  add column retencion_iva numeric(15,2) not null default 0,
  add column retencion_iva_estado text,
  add column retencion_iva_certificado_fecha date,
  add column retencion_iva_certificado_soporte text;

alter table public.cobros
  add constraint cobros_retencion_iva_no_negativa check (retencion_iva >= 0),
  add constraint cobros_retencion_iva_estado_valido
    check (retencion_iva_estado is null or retencion_iva_estado in ('certificado_pendiente', 'certificado_recibido')),
  -- Una retención tiene estado, y un estado tiene retención: nunca uno sin el otro.
  add constraint cobros_retencion_iva_con_estado
    check ((retencion_iva > 0) = (retencion_iva_estado is not null)),
  -- El certificado recibido lleva su fecha; el pendiente no lleva ni fecha ni soporte.
  add constraint cobros_retencion_iva_certificado
    check (
      (retencion_iva_estado = 'certificado_recibido' and retencion_iva_certificado_fecha is not null)
      or (retencion_iva_estado is distinct from 'certificado_recibido'
          and retencion_iva_certificado_fecha is null
          and retencion_iva_certificado_soporte is null)
    );

comment on column public.cobros.retencion_iva is
  'Retención de IVA que practicó el cliente sobre la cuota de este cobro (15% del IVA, ET 437-2 num. 9). No entró en efectivo: `monto` es lo que entró, y lo que el cobro cubre de la cuota es monto + retencion_iva. También está sumada en `retencion` (total retenido).';
comment on column public.cobros.retencion_iva_estado is
  'certificado_pendiente | certificado_recibido. NULL si no hay retención de IVA.';
comment on column public.cobros.retencion_iva_certificado_fecha is
  'Fecha del certificado de retención que expidió el cliente. Obligatoria con certificado_recibido.';
comment on column public.cobros.retencion_iva_certificado_soporte is
  'Dónde está el certificado (referencia one:// o enlace interno). Nunca se muestra al cliente.';


-- ── 3. `mis_cobros_de_servicio(uuid)`, con la retención ─────────────────────────────────

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
  factura_xml_path text,
  retencion_iva numeric
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
    f.xml_path,
    -- Lo que el cliente retuvo de IVA sobre la cuota: cubre la cuota aunque no sea efectivo.
    c.retencion_iva
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
  'Cobros del negocio de un servicio contratado, con su recibo, su factura electrónica y la retención de IVA que practicó el cliente, con lista cerrada de campos y solo para el workspace que paga. Nunca salen cobros.notas ni negocios.metadata.';

-- ejecutable-por-cliente: la invoca el servidor con el cliente de SESIÓN (pestañas Pagos de
-- /valida-api y /valida, y las rutas de descarga) y el filtro por workspace vive dentro.
revoke execute on function public.mis_cobros_de_servicio(uuid) from public, anon;
grant  execute on function public.mis_cobros_de_servicio(uuid) to authenticated;
