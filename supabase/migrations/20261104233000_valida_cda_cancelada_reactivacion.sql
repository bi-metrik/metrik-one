-- ============================================================
-- Valida de los CDA: la suscripción Cancelada guardada y la reactivación (Términos v1.5, 2.5, 11.3,
-- 11.4 y 11.7). PR B del diseño del 4-nov-2026 (proyectos/metrik/valida/docs/legal/
-- 2026-11-04_diseno-suspendido-cancelado.md, D1 a D4, con la revisión de Emilio de D2 y D3).
--
-- SOLO ESTRUCTURA. No toca ni una fila existente: las columnas nacen vacías (NULL) y las tres RPC
-- devuelven lo mismo que hoy más columnas nuevas. Lo escribe el cron (paso 8e) desde el 31-dic-2026.
--
--   1. `servicios_contratados.cancelada_desde`: el día en que la suscripción quedó Cancelada (11.3). Con
--      él, el contrato queda `pausado` (no `terminado` ni `cancelado`: la 11.3 dice que no es terminación
--      y la 11.4 reactiva la misma suscripción). La puerta de Valida lo lee por `mis_servicios()`.
--   2. `servicios_contratados.reactivada_desde`: el día del pago que la reactivó (11.4). Desde ese día la
--      mora y el reparto de lo pagado solo miran el plan nuevo; lo de antes queda como cartera (11.7).
--   3. `servicios_contratados.reactivacion_cobro_id`: el cobro programado (sin plan) del enlace de
--      reactivación. Al pagarse, el servidor crea el plan nuevo desde el día del pago y le ata el cobro.
--   4. `plan_cobro_cuotas.anulada_at` y `anulacion_motivo`: la cuota de un período que empieza desde el
--      1-dic-2026 y no se pagó, al quedar Cancelada (2.5: «METRIK no cobra»). No se borra: se anula, con
--      su motivo, y deja de ser deuda en la pestaña Pagos, en la mora y en los enlaces automáticos.
--   5. `mis_servicios()`, `mis_cuotas_de_servicio(uuid)` y `mis_cobros_de_servicio(uuid)`: las mismas
--      filas y columnas de hoy, más lo que la puerta y la pestaña Pagos necesitan para separar el plan
--      vigente de la cartera. Cambia el tipo de retorno: DROP + CREATE y se repone la ACL.
--
-- Las tres funciones se reescriben con la definición viva (20260924010000 / 20260924100000 con el ancla
-- de la suscripción de 20261016100100). Antes de soltarlas se comprueba que la viva trae el ancla: si
-- producción cambió, la migración se detiene sin tocar nada.
--
-- ROLLBACK (manual, en este orden):
--   - re-crear las tres funciones con los cuerpos de 20260924010000 / 20260924100000 + los reemplazos de
--     20261016100100, con su revoke from public, anon y grant to authenticated;
--   - alter table public.plan_cobro_cuotas drop constraint plan_cobro_cuotas_anulacion_completa,
--       drop column anulacion_motivo, drop column anulada_at;
--   - alter table public.servicios_contratados drop column reactivacion_cobro_id,
--       drop column reactivada_desde, drop column cancelada_desde;
-- ============================================================

-- ── 0. La definición viva es la que se espera ────────────────────────────────────────────

do $$
begin
  if position('p.suscripcion_id = sc.suscripcion_id' in pg_get_functiondef('public.mis_cuotas_de_servicio(uuid)'::regprocedure)) = 0
     or position('c.suscripcion_id = sc.suscripcion_id' in pg_get_functiondef('public.mis_cobros_de_servicio(uuid)'::regprocedure)) = 0
     or position('c.retencion_iva' in pg_get_functiondef('public.mis_cobros_de_servicio(uuid)'::regprocedure)) = 0
     or position('suscripciones_producto s' in pg_get_functiondef('public.mis_servicios()'::regprocedure)) = 0
     or position('sc.terminos_plazo_hasta' in pg_get_functiondef('public.mis_servicios()'::regprocedure)) = 0
  then
    raise exception 'mis_servicios / mis_cuotas_de_servicio / mis_cobros_de_servicio cambiaron en producción: revisar a mano antes de aplicar.';
  end if;
end;
$$;


-- ── 1. La Cancelada y la reactivación, en el contrato ─────────────────────────────────────

alter table public.servicios_contratados
  add column cancelada_desde date,
  add column reactivada_desde date,
  add column reactivacion_cobro_id uuid references public.cobros(id) on delete set null;

comment on column public.servicios_contratados.cancelada_desde is
  'Valida de los CDA (Términos v1.5, 11.3): día desde el cual la suscripción está Cancelada por falta de pago. Lo pone el cron (paso 8e) con el contrato en `pausado`; NULL = no está Cancelada. No es terminación: `terminado` solo se pone a mano, con motivo (12.3, 16.4 o 12.1 sin la v1.5).';
comment on column public.servicios_contratados.reactivada_desde is
  'Valida de los CDA (11.4): día del pago que reactivó la suscripción Cancelada, nueva fecha de renovación. Desde él la mora y el reparto de lo pagado solo miran el plan nuevo (fecha_inicio >= este día); las cuotas anteriores sin pagar son cartera (11.7), sin intereses (2.5) y sin restringir nada.';
comment on column public.servicios_contratados.reactivacion_cobro_id is
  'Valida de los CDA (11.4): el cobro programado sin plan del enlace «Reactivar». Al pagarse, el servidor crea el plan nuevo desde el día del pago, le ata este cobro como su cuota 1 y vuelve el contrato a `activo`.';


-- ── 2. La cuota que no se cobra (2.5) ─────────────────────────────────────────────────────

alter table public.plan_cobro_cuotas
  add column anulada_at timestamptz,
  add column anulacion_motivo text;

alter table public.plan_cobro_cuotas
  add constraint plan_cobro_cuotas_anulacion_completa
    check ((anulada_at is null) = (anulacion_motivo is null)
           and (anulacion_motivo is null or char_length(anulacion_motivo) between 1 and 300));

comment on column public.plan_cobro_cuotas.anulada_at is
  'La cuota no se cobra: un período de Valida de los CDA que empieza desde el 1-dic-2026 y no se pagó, anulado al quedar Cancelada (Términos v1.5, 2.5). Sale de la mora, de la pestaña Pagos y de los enlaces automáticos. NULL = vigente.';
comment on column public.plan_cobro_cuotas.anulacion_motivo is
  'Por qué se anuló la cuota (obligatorio con anulada_at).';


-- ── 3. `mis_servicios()`, con la Cancelada y la reactivación ─────────────────────────────

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
  terminos_plazo_hasta date,
  cancelada_desde date,
  reactivada_desde date
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
    coalesce(n.nombre, s.nombre),
    sc.terminos_plazo_hasta,
    sc.cancelada_desde,
    sc.reactivada_desde
  from public.servicios_contratados sc
  join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
  left join public.negocios n on n.id = sc.negocio_id
  -- suscripciones_producto (20261016): el contrato de una suscripción no tiene negocio.
  left join public.suscripciones_producto s on s.id = sc.suscripcion_id
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
  'Los servicios que cubren al workspace de la sesión, con lista cerrada de campos (el plazo para aceptar los términos y, desde 20261104, la Cancelada y la reactivación de Valida de los CDA). Única vía por la que un cliente lee servicios_contratados, que vive en el workspace del cobrador (§3.6).';

-- ejecutable-por-cliente: la invoca el servidor con el cliente de SESIÓN (puerta de /valida y
-- módulo Valida API) y filtra por current_user_workspace_id() dentro de la propia función.
revoke execute on function public.mis_servicios() from public, anon;
grant  execute on function public.mis_servicios() to authenticated;


-- ── 4. `mis_cuotas_de_servicio(uuid)`, con la anulación y el plan de cada cuota ──────────

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
  factura_xml_path text,
  -- 20261104: la cuota no se cobra (2.5) y el inicio de su plan, para separar el plan vigente de la
  -- cartera desde `reactivada_desde` (11.4), que viaja en cada fila para no pedir otra lectura.
  anulada boolean,
  plan_fecha_inicio date,
  reactivada_desde date
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
    f.xml_path,
    q.anulada_at is not null,
    p.fecha_inicio,
    sc.reactivada_desde
  from public.servicios_contratados sc
  -- Los planes del negocio del contrato, en el workspace del cobrador, encendidos o no.
  join public.planes_cobro p
    on (p.negocio_id = sc.negocio_id or p.suscripcion_id = sc.suscripcion_id)
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
  'Cuotas del contrato (monto, vencimiento, período, si se anularon por la 2.5 y el inicio de su plan) con el enlace de pago de su cobro programado y su factura electrónica, con lista cerrada de campos y solo para el workspace que paga. Nunca salen las notas del plan, las del cobro ni negocios.metadata.';

-- ejecutable-por-cliente: la invoca el servidor con el cliente de SESIÓN (tarjeta y pestaña de
-- pagos de /valida, y la ruta de descarga de facturas) y el filtro por workspace vive dentro.
revoke execute on function public.mis_cuotas_de_servicio(uuid) from public, anon;
grant  execute on function public.mis_cuotas_de_servicio(uuid) to authenticated;


-- ── 5. `mis_cobros_de_servicio(uuid)`, con el plan de cada cobro ─────────────────────────

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
  retencion_iva numeric,
  -- 20261104: el inicio del plan del cobro (NULL si no tiene plan), si es el pago de la reactivación
  -- todavía sin plan, y `reactivada_desde` del contrato: con eso el reparto separa el plan vigente de la
  -- cartera (11.4 y 11.7) y el pago de la reactivación nunca tapa cuotas viejas.
  plan_fecha_inicio date,
  es_reactivacion boolean,
  reactivada_desde date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    c.fecha,
    coalesce(n.nombre, s.nombre),
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
    c.retencion_iva,
    p.fecha_inicio,
    coalesce(c.id = sc.reactivacion_cobro_id, false),
    sc.reactivada_desde
  from public.servicios_contratados sc
  left join public.negocios n on n.id = sc.negocio_id
  -- suscripciones_producto (20261016): el contrato de una suscripción no tiene negocio.
  left join public.suscripciones_producto s on s.id = sc.suscripcion_id
  join public.cobros c on (c.negocio_id = sc.negocio_id or c.suscripcion_id = sc.suscripcion_id)
  left join public.planes_cobro p on p.id = c.plan_cobro_id
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
  'Cobros del negocio de un servicio contratado, con su recibo, su factura electrónica, la retención de IVA que practicó el cliente y (20261104) el inicio de su plan y si es el pago de la reactivación, con lista cerrada de campos y solo para el workspace que paga. Nunca salen cobros.notas ni negocios.metadata.';

-- ejecutable-por-cliente: la invoca el servidor con el cliente de SESIÓN (pestañas Pagos de
-- /valida-api y /valida, y las rutas de descarga) y el filtro por workspace vive dentro.
revoke execute on function public.mis_cobros_de_servicio(uuid) from public, anon;
grant  execute on function public.mis_cobros_de_servicio(uuid) to authenticated;
