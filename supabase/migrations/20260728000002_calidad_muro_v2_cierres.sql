-- Muro v2: cierres por forma de pago, ranking de agentes y ciclo de recobro.
--
-- Origen: segunda tanda de respuestas de Sergio Mora (2026-07-26/27). Dos
-- hallazgos cambian el modelo:
--
--   1. Hay DOS formas de pago con economia opuesta. "Si es por tarjeta de
--      credito se paga de una vez, automatico. Si es por cuenta se pueden hacer
--      cuotas, pero pues si deja de pagar pues se deja de trabajar." Un cierre
--      con tarjeta es caja inmediata; uno por cuenta es una promesa a seis
--      cuotas con riesgo de impago Y de que el servicio se suspenda. Contar los
--      dos como "una venta" es exactamente el error del Excel que hoy se
--      proyecta en el televisor.
--
--   2. Existe un ciclo de recobro medible. "Cuando hacen un debito y el pago no
--      se ve efectivo, se ve fondos insuficientes, se reporta y ellos tienen que
--      volver a llamarle." Es trabajo recurrente que hoy nadie cuantifica.
--
-- Ademas, la cobertura deja de ser el numero heroe del muro: una vez instalado
-- el producto marca 100% siempre, informa una vez y despues es constante. Un
-- televisor necesita algo que se mueva durante el dia y sobre lo que el piso
-- pueda actuar. Baja a linea de pie.

-- ── 1. El cierre de venta y su forma de pago ────────────────────────────────
alter table public.calidad_llamadas
  add column if not exists cerro_venta boolean not null default false,
  add column if not exists forma_pago  text,
  add column if not exists monto_usd   numeric(10,2);

comment on column public.calidad_llamadas.forma_pago is
  'tarjeta = se cobra completo de una vez. cuenta = seis cuotas con riesgo de impago y suspension del servicio. NULL cuando la llamada no cerro venta.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'calidad_llamadas_forma_pago_check'
  ) then
    alter table public.calidad_llamadas
      add constraint calidad_llamadas_forma_pago_check
      check (forma_pago is null or forma_pago in ('tarjeta', 'cuenta'));
  end if;

  -- Coherencia: o cerro venta con forma y monto, o no cerro y no tiene ninguno.
  -- Sin esto se puede colar una venta sin forma de pago, que es justamente el
  -- dato que el muro necesita para partir el numero.
  if not exists (
    select 1 from pg_constraint where conname = 'calidad_llamadas_venta_coherente'
  ) then
    alter table public.calidad_llamadas
      add constraint calidad_llamadas_venta_coherente
      check (
        (cerro_venta = false and forma_pago is null and monto_usd is null)
        or
        (cerro_venta = true and forma_pago is not null and monto_usd is not null)
      );
  end if;
end $$;

create index if not exists idx_calidad_llamadas_ws_cierres
  on public.calidad_llamadas(workspace_id, cerro_venta) where cerro_venta;

-- ── 2. Ciclo de recobro por debito rechazado ────────────────────────────────
--
-- Grano dia. Es un agregado operativo, no una tabla de cobranza: el muro solo
-- necesita cuantos rebotaron hoy y cuantos siguen sin recobrar. Si mas adelante
-- hace falta el detalle por cliente, esa tabla es otra (y con `cliente_ref`,
-- nunca con nombre).
create table if not exists public.calidad_recobro_dia (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  fecha               date not null,
  debitos_rebotados   integer not null default 0 check (debitos_rebotados >= 0),
  pendientes_recobro  integer not null default 0 check (pendientes_recobro >= 0),
  monto_en_riesgo_usd numeric(12,2) not null default 0,
  created_at          timestamptz not null default now(),
  unique (workspace_id, fecha)
);

alter table public.calidad_recobro_dia enable row level security;

drop policy if exists calidad_recobro_dia_select on public.calidad_recobro_dia;
create policy calidad_recobro_dia_select on public.calidad_recobro_dia
  for select to authenticated
  using (workspace_id = current_user_workspace_id());

-- Ver la nota de la migracion 20260727000001: en esta instancia toda tabla nueva
-- nace con TODOS los privilegios para anon/authenticated. Se revoca y se otorga
-- solo lo que se consume.
revoke all on public.calidad_recobro_dia from anon, authenticated;
grant select on public.calidad_recobro_dia to authenticated;

create index if not exists idx_calidad_recobro_ws_fecha
  on public.calidad_recobro_dia(workspace_id, fecha desc);

-- ── 3. RPC del muro, v2 ─────────────────────────────────────────────────────
--
-- Tres zonas, no mas: lo que cabe en un televisor y se lee a tres metros.
--
--   heroe   → cierres de hoy partidos por forma de pago, con monto.
--   ranking → agentes por cierres del dia: cierres · de esos con tarjeta ·
--             semaforo de cumplimiento. Es el corazon de la pantalla: el que va
--             primero cerrando pero con bandera roja es la conversacion del dia.
--   pie     → debitos rebotados pendientes de recobro · cobertura · bandera que
--             mas se repite.
--
-- QUE CAMBIA RESPECTO DE v1, y por que: **el muro ahora SI lleva montos**.
-- Decision explicita de Mauricio. La restriccion que se mantiene intacta es
-- `cliente_ref`: el muro nunca identifica al cliente final, y los agentes
-- siguen saliendo por nombre de pila porque el enlace es publico.
--
-- Se conserva la red de seguridad de fecha (cae al ultimo dia con actividad) y
-- el horario de Colombia explicito.
create or replace function public.get_calidad_muro(
  p_workspace_id uuid,
  p_fecha        date default (now() at time zone 'America/Bogota')::date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with efectiva as (
    select coalesce(
      (select p_fecha
        where exists (
          select 1 from calidad_llamadas
          where workspace_id = p_workspace_id
            and (fecha_hora at time zone 'America/Bogota')::date = p_fecha
        )),
      (select max((fecha_hora at time zone 'America/Bogota')::date)
         from calidad_llamadas where workspace_id = p_workspace_id)
    ) as fecha
  ),
  llamadas_dia as (
    select l.*
    from calidad_llamadas l, efectiva e
    where l.workspace_id = p_workspace_id
      and (l.fecha_hora at time zone 'America/Bogota')::date = e.fecha
  ),
  -- Agente por NOMBRE DE PILA desde el arranque: asi el apellido no existe en
  -- ningun punto del pipeline, ni siquiera en un agregado intermedio.
  por_agente as (
    select
      split_part(agente_nombre, ' ', 1)                                       as agente,
      count(*) filter (where cerro_venta)                                     as cierres,
      count(*) filter (where cerro_venta and forma_pago = 'tarjeta')          as cierres_tarjeta,
      coalesce(sum(monto_usd) filter (where cerro_venta), 0)                  as monto,
      count(*)                                                                as llamadas,
      max(case semaforo when 'rojo' then 3 when 'amarillo' then 2 else 1 end) as peor
    from llamadas_dia
    group by 1
  )
  select jsonb_build_object(
    'fecha', (select fecha from efectiva),
    'esFallback', (select fecha from efectiva) is distinct from p_fecha,

    -- ── Zona 1: el heroe ──
    'cierres', (
      select jsonb_build_object(
        'total',    count(*) filter (where cerro_venta),
        'montoUsd', coalesce(sum(monto_usd) filter (where cerro_venta), 0),
        'llamadas', count(*),
        'tarjeta', jsonb_build_object(
          'n',        count(*) filter (where cerro_venta and forma_pago = 'tarjeta'),
          'montoUsd', coalesce(sum(monto_usd) filter (where cerro_venta and forma_pago = 'tarjeta'), 0)
        ),
        'cuenta', jsonb_build_object(
          'n',        count(*) filter (where cerro_venta and forma_pago = 'cuenta'),
          'montoUsd', coalesce(sum(monto_usd) filter (where cerro_venta and forma_pago = 'cuenta'), 0),
          -- Lo que realmente entra este mes de los cierres por cuenta: una de
          -- seis. El resto es promesa.
          'primeraCuotaUsd', round(coalesce(sum(monto_usd) filter (where cerro_venta and forma_pago = 'cuenta'), 0) / 6.0, 2)
        )
      ) from llamadas_dia
    ),

    -- ── Zona 2: el ranking ──
    'ranking', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'agente',   agente,
          'cierres',  cierres,
          'tarjeta',  cierres_tarjeta,
          'montoUsd', monto,
          'llamadas', llamadas,
          'semaforo', case peor when 3 then 'rojo' when 2 then 'amarillo' else 'verde' end
        )
        order by cierres desc, monto desc, agente
      )
      from (select * from por_agente order by cierres desc, monto desc, agente limit 7) r
    ), '[]'::jsonb),

    -- ── Zona 3: el pie ──
    'pie', jsonb_build_object(
      'recobro', (
        select jsonb_build_object(
          'debitosRebotados',  coalesce(debitos_rebotados, 0),
          'pendientesRecobro', coalesce(pendientes_recobro, 0),
          'montoEnRiesgoUsd',  coalesce(monto_en_riesgo_usd, 0)
        )
        from calidad_recobro_dia c, efectiva e
        where c.workspace_id = p_workspace_id and c.fecha = e.fecha
      ),
      'cobertura', (
        select jsonb_build_object(
          'recibidas', coalesce(recibidas, 0),
          'auditadas', coalesce(auditadas, 0),
          'baseline',  coalesce(baseline_manual, 0),
          'pct', case when coalesce(recibidas, 0) > 0
                      then round(100.0 * auditadas / recibidas) else 0 end
        )
        from calidad_cobertura_dia c, efectiva e
        where c.workspace_id = p_workspace_id and c.fecha = e.fecha
      ),
      'banderaTop', (
        select jsonb_build_object('codigo', h.codigo, 'titulo', min(h.titulo), 'veces', count(*))
        from calidad_llamadas_hallazgos h
        join llamadas_dia l on l.id = h.llamada_id
        where h.eje = 'cumplimiento' and h.codigo is not null
        group by h.codigo
        order by count(*) desc, h.codigo
        limit 1
      )
    )
  );
$$;

revoke execute on function public.get_calidad_muro(uuid, date) from public;
revoke execute on function public.get_calidad_muro(uuid, date) from anon;
grant  execute on function public.get_calidad_muro(uuid, date) to authenticated;
grant  execute on function public.get_calidad_muro(uuid, date) to service_role;
