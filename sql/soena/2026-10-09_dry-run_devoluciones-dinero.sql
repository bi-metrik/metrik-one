-- Dry-run de 20261009160000_devoluciones_dinero.sql (SOE-007) contra producción.
--
-- UN solo statement: lee los tableros de SOENA con las RPC VIVAS, aplica la migración, los vuelve a
-- leer, ENSAYA la devolución de V0494 (637.500, hoy, «cerrar el caso» marcado) y aborta con
-- RAISE EXCEPTION. Nada queda escrito —ni la tabla, ni la devolución, ni el historial—: el
-- resultado vuelve en el mensaje del error. Correrlo por MCP execute_sql y después confirmar:
--   select to_regclass('public.devoluciones_dinero');   -- null
--
-- Lo que tiene que decir:
--   rpc_reescritas = 6 (las seis RPC de recaudo leen v_recaudo_neto_valor). Si la migración aborta
--     con «cambió en producción», la RPC viva no trae `v_cobro_valor cv` las veces esperadas: NO
--     aplicar, mirar esa función.
--   sin_devoluciones_igual = true: aplicada la migración y SIN ninguna devolución, Dirección (sep y
--     el mes en curso), la serie mensual y el resumen del Comercial devuelven exactamente lo mismo.
--   supera_neto.codigo = 'supera_neto' (637.501 sobre un neto de 637.500).
--   ensayo.ok = true, ensayo.ya_cerrado = true, ensayo.cerro_caso = false (V0494 ya está perdido:
--     no se vuelve a cerrar); negocio_igual = true; cobro_igual = true.
--   septiembre_igual = true (Dirección y serie de septiembre no se mueven con la devolución).
--   delta_mes_en_curso: cuánto baja el primer/segundo pago de Dirección y el recaudo de la serie en
--     el mes de la devolución. tramos_v0494: cómo se reparte la devolución (tramo 1, tarifa,
--     tramo 2, excedente) y su base sin IVA.
--   venta_v0494: la fila de V0494 en v_venta_mes_comercial (mes de venta, honorario, primer pago,
--     bonificable). NO cambia con esta migración: es la cifra para decidir con Mauricio si un caso
--     perdido con devolución total debe dejar de contar como venta.
--
-- El cuerpo de la migración va pegado TAL CUAL entre $mig$ (generado, no transcrito). Si se edita
-- la migración, regenerar este archivo.

DO $dry$
DECLARE
  ws     uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  v0494  uuid := '1695e4cf-0799-4a46-8558-171f6ed456d1';
  hoy    date := (now() AT TIME ZONE 'America/Bogota')::date;
  anio   int  := extract(year  FROM (now() AT TIME ZONE 'America/Bogota'))::int;
  mes    int  := extract(month FROM (now() AT TIME ZONE 'America/Bogota'))::int;
  uid    uuid;
  dir_sep_a jsonb; dir_mes_a jsonb; serie_a jsonb; res_sep_a jsonb; res_mes_a jsonb;
  dir_sep_b jsonb; dir_mes_b jsonb; serie_b jsonb; res_sep_b jsonb; res_mes_b jsonb;
  dir_sep_c jsonb; dir_mes_c jsonb; serie_c jsonb;
  neg_a  text; neg_c text; cobro_a text; cobro_c text;
  reescritas int;
  r_supera jsonb;
  r_ok   jsonb;
  tramos jsonb;
  venta  jsonb;
  r      jsonb;
BEGIN
  SELECT p.id INTO uid
  FROM profiles p
  WHERE p.workspace_id = ws AND p.role IN ('owner', 'admin')
  ORDER BY p.role DESC
  LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  IF current_user_workspace_id() IS DISTINCT FROM ws THEN
    RAISE EXCEPTION 'DRYRUN la sesion simulada no resuelve SOENA (uid %): el ensayo no prueba nada', uid;
  END IF;

  dir_sep_a := public.get_directivo_soena(ws, 2026, 9);
  dir_mes_a := public.get_directivo_soena(ws, anio, mes);
  serie_a   := public.get_comercial_serie_mensual_soena(ws, 12);
  res_sep_a := public.get_comercial_resumen_soena(ws, 2026, 9);
  res_mes_a := public.get_comercial_resumen_soena(ws, anio, mes);
  SELECT md5(row_to_json(n)::text) INTO neg_a FROM negocios n WHERE n.id = v0494;
  SELECT md5(string_agg(row_to_json(c)::text, '|' ORDER BY c.id)) INTO cobro_a FROM cobros c WHERE c.negocio_id = v0494;

  EXECUTE $mig$
-- ============================================================
-- 20261009160000_devoluciones_dinero
-- ============================================================
-- SOE-007 (Daniela, SOENA, «NO SUMAR DESISTIDO», V0494 Catherine Chacon). Pedido de Mauricio
-- (2026-10-09): «Debemos crear en tesorería la opción de devolución de dinero para que tengamos
-- claridad del momento y el monto y a qué negocio está asociado, el motivo y si el caso se
-- cierra. En una sola función la financiera se encarga de cerrar el caso.»
--
-- ── Por qué un movimiento propio y no anular el cobro ──
--
-- `anularCobro` deja el monto del cobro en 0: borraría de septiembre un ingreso que SÍ entró, y
-- con eso reescribiría un mes cerrado. Una devolución es otra cosa: una SALIDA de dinero en la
-- fecha en que ocurrió. El cobro original queda intacto y la devolución vive en su propia fila.
--
-- Tampoco es un cobro negativo: `cobros` alimenta el saldo del negocio, los gates `saldo_cero`,
-- el routing, la conciliación ePayco, Siigo y los recibos. Un monto negativo ahí cae en
-- `v_cobro_valor` como «excedente» (no descuenta ingreso) y se mezcla con
-- `devolucion_pendiente`, que es otra cosa (remanente de un sobrepago por devolver).
--
-- ── Qué trae ──
--
--   1. Tabla `devoluciones_dinero`: negocio, fecha, monto, motivo, soporte, si cerró el caso y
--      quién la registró. Se LEE con sesión (ficha del negocio, Tesorería); se ESCRIBE solo por
--      la función de abajo, con el cliente de servicio, después del guard de permisos.
--   2. `registrar_devolucion_dinero`: UNA operación. Bloquea el negocio, valida contra lo
--      recaudado neto (lo cobrado menos las devoluciones anteriores), inserta, y si se pidió
--      cierra el negocio como perdido con el mismo efecto que `perderNegocio` (estado, razón,
--      descripción, closed_at y la entrada `cambio_estado` del historial). Si ya estaba
--      cerrado no lo vuelve a cerrar. Deja la devolución en el historial (`cambio` con
--      `campo_modificado = 'devolucion_dinero'`, que no se puede borrar como un comentario).
--   3. `v_devolucion_valor`: reparte cada devolución en los mismos tramos que `v_cobro_valor`
--      (tramo 1, tarifa UPME, tramo 2, excedente), desde ARRIBA: devuelve primero lo último
--      que entró. Con las columnas `_base` netas de IVA, igual que los tableros.
--   4. `v_recaudo_neto_valor`: `v_cobro_valor` + las devoluciones en negativo, fechadas el día
--      de la devolución. Es la que leen los bloques de RECAUDO POR MES de los tableros.
--   5. Seis RPC de tablero pasan a leer `v_recaudo_neto_valor` en sus bloques de recaudo (ver
--      abajo). La devolución resta en el MES de la devolución; los meses anteriores no cambian.
--
-- ── Lo que NO cambia, a propósito ──
--
--   * `v_cobro_valor`: la siguen leyendo gates, conciliación, Siigo y cartera.
--   * `v_venta_mes_comercial` y todo lo que cuenta VENTAS (cohorte por `fecha_venta`): KPIs del
--     mes, ventas del mes, conteo de «negocios cerrados» de Dirección, bonificables. Restar ahí
--     movería septiembre. Si un caso perdido con devolución total debe dejar de contar como
--     venta, es decisión aparte (reporte de SOE-007).
--   * `get_comercial_pagos_mes_soena`: es el panel que se concilia contra banco y ePayco; lista
--     lo que ENTRÓ.
--   * `get_segundo_pago_*`: cuentan segundos pagos, no recaudo neto.
--
-- ── Por qué los reemplazos son sobre `pg_get_functiondef` ──
--
-- Las RPC de SOENA han divergido del repo antes (migraciones aplicadas por MCP sin archivo) y la
-- definición viva no se pudo leer al escribir esto. Reescribirlas desde el repo podría revertir
-- en silencio lo que haya cambiado allá. Se hace UN reemplazo de texto por función
-- (`v_cobro_valor cv` → `v_recaudo_neto_valor cv`, patrón de 20261008223000) y cada uno ABORTA si
-- el patrón no aparece exactamente las veces esperadas. Idempotente: si la función ya lee
-- `v_recaudo_neto_valor`, se salta.
-- ============================================================

-- ── 1. Tabla ──────────────────────────────────────────────────────────────────

create table public.devoluciones_dinero (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  negocio_id       uuid not null references public.negocios(id) on delete restrict,
  -- Día en que el dinero salió (hora de Bogotá). Es el que decide el mes en los tableros.
  fecha            date not null,
  monto            numeric(15,2) not null check (monto > 0),
  motivo           text not null check (length(btrim(motivo)) >= 10),
  -- Mismo formato que `cobros.soporte` (referencia del archivo en Storage/Drive). Opcional.
  soporte          jsonb,
  -- La casilla «cerrar el caso» estaba marcada Y el negocio estaba abierto: esta devolución
  -- lo cerró. Marcada sobre un negocio ya cerrado queda en false (no lo cerró ella).
  cerro_caso       boolean not null default false,
  razon_cierre     text,
  creado_por       uuid references public.profiles(id) on delete set null,
  creado_por_staff uuid references public.staff(id) on delete set null,
  created_at       timestamptz not null default now()
);

comment on table public.devoluciones_dinero is
  'SOE-007. Dinero devuelto a un cliente: una SALIDA en su fecha, no una anulación del cobro. '
  'Resta del recaudo neto en el mes de la devolución (v_recaudo_neto_valor). Se escribe solo '
  'por registrar_devolucion_dinero (service_role).';

create index devoluciones_dinero_negocio_idx on public.devoluciones_dinero (negocio_id, fecha);
create index devoluciones_dinero_ws_fecha_idx on public.devoluciones_dinero (workspace_id, fecha);

alter table public.devoluciones_dinero enable row level security;

-- Lectura con sesión: la ficha del negocio y la lista de Tesorería. Escritura: NINGUNA policy,
-- así que el cliente authenticated no puede insertar ni tocar filas; solo la función de abajo,
-- llamada con service_role después de `ctxPagosExternos`.
create policy devoluciones_dinero_select on public.devoluciones_dinero
  for select to authenticated
  using (workspace_id = current_user_workspace_id());

grant select on public.devoluciones_dinero to authenticated;

-- ── 2. Registrar (una sola operación) ─────────────────────────────────────────

create or replace function public.registrar_devolucion_dinero(
  p_workspace_id uuid,
  p_negocio_id   uuid,
  p_fecha        date,
  p_monto        numeric,
  p_motivo       text,
  p_soporte      jsonb,
  p_cerrar_caso  boolean,
  p_razon_cierre text,
  p_razon_label  text,
  p_profile_id   uuid,
  p_staff_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_neg       record;
  v_hoy       date := (now() at time zone 'America/Bogota')::date;
  v_cobrado   numeric;
  v_devuelto  numeric;
  v_neto      numeric;
  v_id        uuid;
  v_cierra    boolean := false;
  v_motivo    text := btrim(coalesce(p_motivo, ''));
  v_texto     text;
begin
  if p_monto is null or p_monto <= 0 then
    return jsonb_build_object('ok', false, 'codigo', 'monto_invalido');
  end if;
  if p_fecha is null or p_fecha > v_hoy then
    return jsonb_build_object('ok', false, 'codigo', 'fecha_futura');
  end if;
  if length(v_motivo) < 10 then
    return jsonb_build_object('ok', false, 'codigo', 'motivo_requerido');
  end if;

  -- El candado del negocio serializa dos devoluciones simultáneas: sin él, las dos leerían el
  -- mismo neto y juntas podrían devolver más de lo que entró.
  select n.id, n.estado
    into v_neg
    from negocios n
   where n.id = p_negocio_id and n.workspace_id = p_workspace_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'negocio_no_encontrado');
  end if;

  if p_cerrar_caso and v_neg.estado = 'abierto' and nullif(btrim(coalesce(p_razon_cierre, '')), '') is null then
    return jsonb_build_object('ok', false, 'codigo', 'razon_requerida');
  end if;

  -- Lo cobrado: los cobros del negocio que ya ENTRARON (con fecha: un `programado` sin fecha es
  -- una cuota por pagar) y un anulado ya vale 0. Sin `devolucion_pendiente`, que es un remanente
  -- por devolver, no plata que entró.
  select coalesce(sum(c.monto), 0) into v_cobrado
    from cobros c
   where c.negocio_id = p_negocio_id and c.workspace_id = p_workspace_id
     and c.fecha is not null
     and coalesce(c.tipo_cobro, '') <> 'devolucion_pendiente';
  select coalesce(sum(d.monto), 0) into v_devuelto
    from devoluciones_dinero d
   where d.negocio_id = p_negocio_id and d.workspace_id = p_workspace_id;
  v_neto := v_cobrado - v_devuelto;

  if p_monto > v_neto then
    return jsonb_build_object('ok', false, 'codigo', 'supera_neto',
      'cobrado', v_cobrado, 'devuelto', v_devuelto, 'neto', v_neto);
  end if;

  v_cierra := coalesce(p_cerrar_caso, false) and v_neg.estado = 'abierto';

  insert into devoluciones_dinero
    (workspace_id, negocio_id, fecha, monto, motivo, soporte, cerro_caso, razon_cierre,
     creado_por, creado_por_staff)
  values
    (p_workspace_id, p_negocio_id, p_fecha, p_monto, v_motivo, p_soporte, v_cierra,
     case when v_cierra then btrim(p_razon_cierre) end, p_profile_id, p_staff_id)
  returning id into v_id;

  -- Cierre con el mismo efecto que `perderNegocio` (negocio-v2-actions.ts).
  if v_cierra then
    update negocios
       set estado = 'perdido',
           razon_cierre = btrim(p_razon_cierre),
           descripcion_cierre = 'Devolución de dinero: ' || v_motivo,
           closed_at = now()
     where id = p_negocio_id and workspace_id = p_workspace_id;

    insert into activity_log (workspace_id, entidad_tipo, entidad_id, tipo, autor_id, contenido, valor_nuevo)
    values (p_workspace_id, 'negocio', p_negocio_id, 'cambio_estado', p_staff_id,
            'Negocio desistido. Motivo: ' || coalesce(nullif(btrim(p_razon_label), ''), btrim(p_razon_cierre))
              || ' (cerrado al registrar una devolución de dinero)',
            'perdido');
  end if;

  v_texto := 'Devolución de dinero de $' || replace(to_char(round(p_monto), 'FM999,999,999,990'), ',', '.')
    || ' con fecha ' || to_char(p_fecha, 'YYYY-MM-DD') || '. Motivo: ' || v_motivo || '. '
    || case
         when v_cierra then 'Cerró el caso.'
         when coalesce(p_cerrar_caso, false) then 'El caso ya estaba cerrado; no se volvió a cerrar.'
         else 'El caso sigue en su estado.'
       end
    || case when p_soporte is not null then ' Soporte adjunto.' else '' end;

  insert into activity_log (workspace_id, entidad_tipo, entidad_id, tipo, autor_id, campo_modificado, valor_nuevo, contenido)
  values (p_workspace_id, 'negocio', p_negocio_id, 'cambio', p_staff_id, 'devolucion_dinero',
          p_monto::text, left(v_texto, 1000));

  return jsonb_build_object(
    'ok', true,
    'devolucion_id', v_id,
    'cerro_caso', v_cierra,
    'ya_cerrado', coalesce(p_cerrar_caso, false) and not v_cierra,
    'neto_antes', v_neto,
    'neto_despues', v_neto - p_monto
  );
end;
$function$;

-- server-only: la llama solo el servidor con service_role, después de `ctxPagosExternos`
-- (financiera u owner/admin). Con sesión, un operador podría saltarse ese guard.
revoke execute on function public.registrar_devolucion_dinero(uuid, uuid, date, numeric, text, jsonb, boolean, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_devolucion_dinero(uuid, uuid, date, numeric, text, jsonb, boolean, text, text, uuid, uuid)
  to service_role;

-- ── 3. Cada devolución repartida en tramos ────────────────────────────────────
--
-- Espejo de `v_cobro_valor`. La devolución ocupa la franja [desde, hasta] del acumulado del
-- negocio, donde `hasta` es lo cobrado (mismos cobros elegibles que `v_cobro_valor`: con fecha
-- y no pasantes) menos las devoluciones anteriores. O sea, se devuelve desde ARRIBA: primero lo
-- último que entró (excedente, tramo 2, tarifa, tramo 1). Lo que no cabe en la franja (una
-- devolución mayor que lo elegible) va a excedente, que ningún tablero cuenta como ingreso.
--
-- Límite conocido: `v_cobro_valor` no ve las devoluciones, así que un cobro POSTERIOR a una
-- devolución se sigue imputando como si la plata devuelta estuviera adentro. Solo importa si
-- el cliente vuelve a pagar después de una devolución.

create view public.v_devolucion_valor with (security_invoker = on) as
with cobrado as (
  select c.negocio_id, sum(greatest(c.monto, 0::numeric)) as total
  from cobros c
  where c.fecha is not null and coalesce(c.tipo_cobro, ''::text) <> 'pasante'::text
  group by c.negocio_id
),
ordenadas as (
  select d.id, d.workspace_id, d.negocio_id, d.fecha, d.monto,
         coalesce(sum(d.monto) over (
           partition by d.negocio_id order by d.fecha, d.created_at, d.id
           rows between unbounded preceding and 1 preceding), 0::numeric) as devuelto_antes
  from devoluciones_dinero d
),
franjas as (
  select o.id, o.workspace_id, o.negocio_id, o.fecha, o.monto, v.linea_id,
         coalesce(v.iva_frac, 0::numeric) as iva_frac,
         coalesce(v.iva_origen, 'sin_declarar'::text) as iva_origen,
         v.techo_tramo1 as fin_tramo1,
         v.techo_tramo1 + coalesce(v.techo_tarifa, 0::numeric) as fin_tarifa,
         v.techo_tramo1 + coalesce(v.techo_tarifa, 0::numeric) + coalesce(v.techo_tramo2, 0::numeric) as fin_tramo2,
         greatest(coalesce(cb.total, 0::numeric) - o.devuelto_antes, 0::numeric) as hasta
  from ordenadas o
  left join v_negocio_valor v on v.negocio_id = o.negocio_id
  left join cobrado cb on cb.negocio_id = o.negocio_id
),
imputado as (
  select f.*, greatest(f.hasta - f.monto, 0::numeric) as desde, f.fin_tramo1 is null as sin_techo
  from franjas f
),
repartido as (
  select i.id as devolucion_id, i.workspace_id, i.negocio_id, i.linea_id, i.fecha, i.monto,
         i.iva_frac, i.iva_origen,
         case when i.sin_techo then i.monto
              else greatest(0::numeric, least(i.hasta, i.fin_tramo1) - greatest(i.desde, 0::numeric))
         end as a_tramo1,
         case when i.sin_techo then 0::numeric
              else greatest(0::numeric, least(i.hasta, i.fin_tarifa) - greatest(i.desde, i.fin_tramo1))
         end as a_tarifa,
         case when i.sin_techo then 0::numeric
              else greatest(0::numeric, least(i.hasta, i.fin_tramo2) - greatest(i.desde, i.fin_tarifa))
         end as a_tramo2
  from imputado i
)
select r.devolucion_id, r.workspace_id, r.negocio_id, r.linea_id, r.fecha, r.monto,
       r.iva_frac, r.iva_origen, r.a_tramo1, r.a_tarifa, r.a_tramo2,
       r.monto - r.a_tramo1 - r.a_tarifa - r.a_tramo2 as excedente,
       round(r.a_tramo1 / (1::numeric + r.iva_frac), 2) as a_tramo1_base,
       round(r.a_tramo2 / (1::numeric + r.iva_frac), 2) as a_tramo2_base
from repartido r;

comment on view public.v_devolucion_valor is
  'SOE-007. Cada devolución de dinero repartida en los tramos de v_cobro_valor, desde arriba '
  '(se devuelve primero lo último que entró). Montos POSITIVOS; v_recaudo_neto_valor los resta.';

-- ── 4. Recaudo neto: cobros + devoluciones en negativo ────────────────────────
--
-- Mismas columnas que `v_cobro_valor` (nombradas una por una), así que los bloques de recaudo
-- de las RPC la leen sin cambiar nada más. Una devolución entra con `cobro_id` = id de la
-- devolución, `tipo_cobro = 'devolucion_dinero'` y todo en negativo. `completa_tramo*` en false:
-- devolver no completa nada.

create view public.v_recaudo_neto_valor with (security_invoker = on) as
select cv.cobro_id, cv.workspace_id, cv.negocio_id, cv.linea_id, cv.fecha, cv.tipo_cobro, cv.monto,
       cv.iva_frac, cv.iva_origen, cv.a_tramo1, cv.a_tarifa, cv.a_tramo2, cv.excedente,
       cv.completa_tramo1, cv.completa_tramo2, cv.a_tramo1_base, cv.a_tramo2_base,
       false as es_devolucion
from v_cobro_valor cv
union all
select dv.devolucion_id, dv.workspace_id, dv.negocio_id, dv.linea_id, dv.fecha,
       'devolucion_dinero'::text, -dv.monto,
       dv.iva_frac, dv.iva_origen, -dv.a_tramo1, -dv.a_tarifa, -dv.a_tramo2, -dv.excedente,
       false, false, -dv.a_tramo1_base, -dv.a_tramo2_base,
       true
from v_devolucion_valor dv;

comment on view public.v_recaudo_neto_valor is
  'SOE-007. v_cobro_valor + devoluciones de dinero en negativo, en la fecha de la devolución. '
  'La leen los bloques de RECAUDO POR MES de los tableros (Dirección y Comercial). No usar '
  'para ventas, gates, conciliación ni cartera: ahí manda v_cobro_valor.';

-- Las dos vistas las leen las RPC de tablero (SECURITY DEFINER, corren como su dueño) y el
-- servidor con service_role. No se conceden a `authenticated`.

-- ── 5. Las RPC de tablero leen el recaudo neto ────────────────────────────────
--
-- Firma y veces que aparece `v_cobro_valor cv` en la última versión del repo:
--   get_directivo_soena                  1  (`pagos`: primer y segundo pago del mes)
--   get_comercial_serie_mensual_soena    1  (`recaudo_por_mes`)
--   get_comercial_serie_seccional_soena  1  (`recaudo_agr`)
--   get_comercial_serie_vendedor_soena   1  (recaudo por vendedor y mes)
--   get_comercial_resumen_soena          1  (honorario recaudado del periodo por negocio)
--   get_comercial_perfil_soena           2  (honorario del periodo/pendiente y `recaudo_mes`)
-- Si la viva no trae exactamente ese número, la migración entera aborta.

do $$
declare
  v_firmas   text[] := array[
    'public.get_directivo_soena(uuid,integer,integer)',
    'public.get_comercial_serie_mensual_soena(uuid,integer)',
    'public.get_comercial_serie_seccional_soena(uuid,integer)',
    'public.get_comercial_serie_vendedor_soena(uuid,integer)',
    'public.get_comercial_resumen_soena(uuid,integer,integer)',
    'public.get_comercial_perfil_soena(uuid,integer,integer)'
  ];
  v_esperado int[] := array[1, 1, 1, 1, 1, 2];
  v_viejo    constant text := 'v_cobro_valor cv';
  v_nuevo    constant text := 'v_recaudo_neto_valor cv';
  v_def      text;
  v_n        int;
  i          int;
begin
  for i in 1 .. array_length(v_firmas, 1) loop
    v_def := pg_get_functiondef(v_firmas[i]::regprocedure);

    if position(v_nuevo in v_def) > 0 then
      raise notice '% ya lee v_recaudo_neto_valor: se salta', v_firmas[i];
      continue;
    end if;

    v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_n <> v_esperado[i] then
      raise exception '% cambió en producción: "%" aparece % veces (se esperaban %). Revisar a mano antes de aplicar.',
        v_firmas[i], v_viejo, v_n, v_esperado[i];
    end if;

    execute replace(v_def, v_viejo, v_nuevo);
  end loop;
end;
$$;

$mig$;

  SELECT count(*) INTO reescritas
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_directivo_soena', 'get_comercial_serie_mensual_soena',
                      'get_comercial_serie_seccional_soena', 'get_comercial_serie_vendedor_soena',
                      'get_comercial_resumen_soena', 'get_comercial_perfil_soena')
    AND position('v_recaudo_neto_valor cv' in pg_get_functiondef(p.oid)) > 0;

  -- Sin devoluciones, nada cambia.
  dir_sep_b := public.get_directivo_soena(ws, 2026, 9);
  dir_mes_b := public.get_directivo_soena(ws, anio, mes);
  serie_b   := public.get_comercial_serie_mensual_soena(ws, 12);
  res_sep_b := public.get_comercial_resumen_soena(ws, 2026, 9);
  res_mes_b := public.get_comercial_resumen_soena(ws, anio, mes);

  -- El ensayo de V0494: primero por encima del neto (debe rechazar), luego la devolución total.
  r_supera := public.registrar_devolucion_dinero(ws, v0494, hoy, 637501, 'Dry-run SOE-007: ensayo por encima del neto',
                                                 NULL, true, NULL, NULL, NULL, NULL);
  r_ok     := public.registrar_devolucion_dinero(ws, v0494, hoy, 637500, 'Dry-run SOE-007: ensayo de la devolucion total',
                                                 NULL, true, NULL, NULL, NULL, NULL);

  dir_sep_c := public.get_directivo_soena(ws, 2026, 9);
  dir_mes_c := public.get_directivo_soena(ws, anio, mes);
  serie_c   := public.get_comercial_serie_mensual_soena(ws, 12);
  SELECT md5(row_to_json(n)::text) INTO neg_c FROM negocios n WHERE n.id = v0494;
  SELECT md5(string_agg(row_to_json(c)::text, '|' ORDER BY c.id)) INTO cobro_c FROM cobros c WHERE c.negocio_id = v0494;

  SELECT jsonb_agg(to_jsonb(dv) - 'workspace_id' - 'negocio_id' - 'linea_id') INTO tramos
  FROM v_devolucion_valor dv WHERE dv.negocio_id = v0494;

  SELECT to_jsonb(v) - 'workspace_id' - 'contacto_id' - 'responsable_id' INTO venta
  FROM v_venta_mes_comercial v WHERE v.negocio_id = v0494;

  r := jsonb_build_object(
    'rpc_reescritas', reescritas,
    'sin_devoluciones_igual',
      dir_sep_b = dir_sep_a AND dir_mes_b = dir_mes_a AND serie_b = serie_a
      AND res_sep_b = res_sep_a AND res_mes_b = res_mes_a,
    'supera_neto', r_supera,
    'ensayo', r_ok,
    'negocio_igual', neg_c = neg_a,
    'cobro_igual', cobro_c = cobro_a,
    'septiembre_igual', dir_sep_c = dir_sep_a
      AND (SELECT p FROM jsonb_array_elements(serie_c->'serie') p WHERE (p->>'anio')::int = 2026 AND (p->>'mes')::int = 9)
        = (SELECT p FROM jsonb_array_elements(serie_a->'serie') p WHERE (p->>'anio')::int = 2026 AND (p->>'mes')::int = 9),
    'mes_en_curso', anio || '-' || mes,
    'delta_mes_en_curso', jsonb_build_object(
      'direccion_primer_pago', (dir_mes_c->'comercial'->>'primer_pago')::numeric - (dir_mes_a->'comercial'->>'primer_pago')::numeric,
      'direccion_segundo_pago', (dir_mes_c->'comercial'->>'segundo_pago')::numeric - (dir_mes_a->'comercial'->>'segundo_pago')::numeric,
      'direccion_negocios_cerrados', (dir_mes_c->'comercial'->>'negocios_cerrados')::int - (dir_mes_a->'comercial'->>'negocios_cerrados')::int,
      'serie_honorario_recaudado',
        (SELECT (p->>'honorario_recaudado')::numeric FROM jsonb_array_elements(serie_c->'serie') p WHERE (p->>'anio')::int = anio AND (p->>'mes')::int = mes)
        - (SELECT (p->>'honorario_recaudado')::numeric FROM jsonb_array_elements(serie_a->'serie') p WHERE (p->>'anio')::int = anio AND (p->>'mes')::int = mes),
      'serie_tarifa_recaudada',
        (SELECT (p->>'tarifa_recaudada')::numeric FROM jsonb_array_elements(serie_c->'serie') p WHERE (p->>'anio')::int = anio AND (p->>'mes')::int = mes)
        - (SELECT (p->>'tarifa_recaudada')::numeric FROM jsonb_array_elements(serie_a->'serie') p WHERE (p->>'anio')::int = anio AND (p->>'mes')::int = mes)
    ),
    'direccion_sep_antes', dir_sep_a->'comercial',
    'tramos_v0494', tramos,
    'venta_v0494', venta
  );

  RAISE EXCEPTION 'DRYRUN %', jsonb_pretty(r);
END
$dry$;
