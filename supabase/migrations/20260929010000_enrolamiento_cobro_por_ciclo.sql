-- ============================================================
-- 20260929010000 — El eslabón que faltaba: `servicios_contratados` → `planes_cobro`
-- Spec: proyectos/metrik/one/2026-09-28_spec-radar-secop-en-one.md, bloque C.
-- Autorizado por Mauricio el 2026-09-28: «el periodo de prueba de 5 días después de aceptar
-- los términos y que para seguir usando el servicio tenga que pagar con el link».
--
-- ## Qué problema resuelve
--
-- El PR #952 midió que `disparador_cobro: ciclo` NO lo lee ningún cron: enrolar un contrato en
-- `servicios_contratados` no emite la cuota, no genera el enlace y no manda el aviso. El plan de
-- cobro y sus cuotas los crea hoy UNA PERSONA a mano. Y el trial (`parametros.dias_trial`) no lo
-- hace cumplir nada: el ciclo corre por fechas que alguien digita.
--
-- Esta migración crea lo mínimo para que ese paso lo dé el cron diario y NADA MÁS:
--
--   1. `servicio_cobro_enrolamiento` — una fila por contrato ya enrolado. Es la llave de
--      idempotencia (PRIMARY KEY sobre el contrato) y el acta de con qué ancla se enroló.
--   2. `enrolar_cobro_por_ciclo(...)` — crea el plan, sus cuotas y esa fila **en una sola
--      transacción**. El cliente de Supabase no sabe abrir transacciones: tres inserts sueltos
--      dejarían un plan sin acta, y la corrida siguiente lo volvería a crear. Mismo patrón que
--      `registrar_version_catalogo` (A2), por la misma razón.
--
-- ## El ancla del trial la hace cumplir la BASE, no el código
--
-- `fin_trial = (ancla_at en Bogotá)::date + dias_trial` es un CHECK, y la primera cuota tiene que
-- vencer EXACTAMENTE ese día. O sea: con la aceptación del 29-sep y 5 días de trial, la cuota 1
-- vence el 4-oct y no hay forma de escribir otra cosa — ni un trial más largo «por esta vez», ni
-- una cuota antes de que el trial termine. Un defecto del servidor no puede correr la fecha: la
-- base rechaza la fila. Y `ancla_at` sale de `aceptaciones_terminos.respondido_at`, que ya es
-- inmutable por trigger desde 20260915060000.
--
-- ## Qué NO hace, a propósito
--
--   · **No escribe ni una fila de datos.** DDL + una función. Ningún contrato queda enrolado:
--     `servicio_cobro_enrolamiento` nace en 0 filas y solo el cron la escribe.
--   · **El plan nace `activo = false`.** `activo` es el interruptor del EMISOR de cuentas de cobro
--     (`emitirCuentasExplicitasPeriodo` solo lee planes activos, y el paso 4 del cron emite desde
--     el día 10 en los espacios con `modules.cobros_recurrentes`, que `metrik` tiene). El Radar se
--     cobra por ENLACE, no por cuenta de cobro: un plan activo le emitiría a Fabri una cuenta de
--     cobro que nadie pidió. El paso 6 del cron (el enlace) no mira `activo` a propósito
--     (`enlace-automatico.ts`), así que el enlace sí sale. Es el mismo arreglo que tiene el plan de
--     `cda-pruebas` en producción.
--   · **No toca `suscripciones`.** Ese ciclo (Fase 1, pasarela `manual`) no cobra, y meterle una
--     fila al Radar le pondría un segundo reloj al mismo contrato.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select relname, relrowsecurity from pg_class
--    where relnamespace = 'public'::regnamespace and relname = 'servicio_cobro_enrolamiento';
--     -> 1 fila, relrowsecurity = true
--   select has_table_privilege('anon', 'public.servicio_cobro_enrolamiento', 'select'),
--          has_table_privilege('authenticated', 'public.servicio_cobro_enrolamiento', 'select');
--     -> false, false
--   select has_function_privilege('anon', 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', 'execute'),
--          has_function_privilege('authenticated', 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', 'execute');
--     -> false, false
--   select count(*) from public.servicio_cobro_enrolamiento;   -> 0
--
-- ## Cómo revertir (nada la usa hasta que el cron corra)
--
--   drop function public.enrolar_cobro_por_ciclo(uuid, timestamptz, integer, jsonb, jsonb);
--   drop table public.servicio_cobro_enrolamiento;
-- ============================================================


-- ── 1. El acta del enrolamiento ─────────────────────────────────────────────
--
-- server-only: la escribe `enrolar_cobro_por_ciclo` desde el cron (service_role) y la leen el
-- mismo cron y la puerta del módulo, siempre del lado del servidor. El cliente no necesita saber
-- de ella: lo que el cliente ve son sus cuotas y su enlace, por las RPC que ya existen.
create table public.servicio_cobro_enrolamiento (
  -- Un contrato se enrola UNA vez. La llave primaria es la idempotencia: dos corridas del cron el
  -- mismo día (o dos crons a la vez) no pueden crear dos planes.
  servicio_contratado_id uuid primary key references public.servicios_contratados(id),

  -- El cobrador (metrik). Sale del contrato, se copia para poder leer sin join.
  workspace_id uuid not null references public.workspaces(id),
  negocio_id uuid not null references public.negocios(id),
  plan_cobro_id uuid not null references public.planes_cobro(id),

  -- El ancla: el instante en que se aceptaron los términos (`aceptaciones_terminos.respondido_at`,
  -- el reloj de la base, no el del navegador). No la fecha en que alguien enroló el contrato.
  ancla_at timestamptz not null,
  dias_trial integer not null
    constraint enrolamiento_dias_trial check (dias_trial >= 0 and dias_trial <= 365),
  fin_trial date not null,

  -- Lo que se enroló, para poder auditar sin reconstruirlo del plan.
  monto numeric(15, 2) not null
    constraint enrolamiento_monto check (monto > 0),
  total_cuotas integer not null
    constraint enrolamiento_total_cuotas check (total_cuotas between 1 and 60),

  creado_at timestamptz not null default now(),

  -- ⚠️ EL ANCLA. `timezone(text, timestamptz)` es IMMUTABLE, así que puede vivir en un CHECK.
  -- Todas las columnas son NOT NULL: aquí no hay NULL que deje pasar la comparación.
  constraint enrolamiento_fin_trial_es_el_ancla check
    (fin_trial = (ancla_at at time zone 'America/Bogota')::date + dias_trial)
);

alter table public.servicio_cobro_enrolamiento enable row level security;
revoke all on table public.servicio_cobro_enrolamiento from public, anon, authenticated;

create index idx_enrolamiento_plan on public.servicio_cobro_enrolamiento (plan_cobro_id);
create index idx_enrolamiento_negocio on public.servicio_cobro_enrolamiento (workspace_id, negocio_id);

comment on table public.servicio_cobro_enrolamiento is
  'Un contrato de servicio ya enrolado al cobro por ciclo: su plan, y con qué ancla (aceptación de términos) y cuántos días de trial se calculó la primera cuota. La llave primaria es la idempotencia del cron.';
comment on column public.servicio_cobro_enrolamiento.ancla_at is
  'aceptaciones_terminos.respondido_at de la PRIMERA aceptación del contrato. Aceptar de nuevo (otra versión) no mueve el trial.';

-- El acta no se reescribe: es la prueba de por qué la cuota 1 vence cuando vence. Sin esto,
-- «el trial no se puede extender» sería una promesa del servidor y un UPDATE la rompería sin
-- dejar rastro. Corregir un enrolamiento equivocado = anular el cobro y decidirlo a mano.
create or replace function public.enrolamiento_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'servicio_cobro_enrolamiento (%): el acta de un enrolamiento no se reescribe ni se borra; el trial no se extiende por UPDATE',
    coalesce(old.servicio_contratado_id, new.servicio_contratado_id);
end;
$$;

create trigger trg_enrolamiento_inmutable
  before update or delete on public.servicio_cobro_enrolamiento
  for each row execute function public.enrolamiento_inmutable();

revoke execute on function public.enrolamiento_inmutable() from public, anon, authenticated;


-- ── 2. Enrolar: plan + cuotas + acta, atómico e idempotente ─────────────────
--
-- Devuelve qué pasó, para que el cron lo reporte sin adivinar:
--
--   'creado'          -> el plan y sus cuotas quedaron escritos (con el id del plan)
--   'ya_estaba'       -> el contrato ya tenía acta: nada que hacer (corrida repetida)
--   'plan_existente'  -> el negocio del contrato YA tiene un plan de cobro que no creó este
--                        eslabón (los que hoy se cargan a mano). No se escribe nada: dos planes
--                        sobre el mismo negocio cobrarían dos veces el mismo ciclo.
--
-- Todo lo que decide, lo decide ANTES de escribir. El calendario y los montos los calcula
-- `src/lib/cobros/enrolar-ciclo.ts` (puro, con pruebas); esta función es la que los hace ciertos:
-- si el calendario que llega no arranca el día que termina el trial, la rechaza.
create or replace function public.enrolar_cobro_por_ciclo(
  p_servicio_contratado_id uuid,
  p_ancla_at timestamptz,
  p_dias_trial integer,
  p_plan jsonb,
  p_cuotas jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_contrato record;
  v_fin_trial date;
  v_total integer;
  v_plan_id uuid;
  v_existente uuid;
  v_monto numeric(15, 2);
  v_cuota jsonb;
  v_n integer;
begin
  if p_ancla_at is null or p_dias_trial is null then
    raise exception 'enrolar_cobro_por_ciclo: sin ancla ni días de trial no hay trial que anclar';
  end if;

  select sc.id, sc.workspace_id, sc.negocio_id, sc.estado
    into v_contrato
    from public.servicios_contratados sc
   where sc.id = p_servicio_contratado_id
     for update;
  if not found then
    raise exception 'enrolar_cobro_por_ciclo: el contrato % no existe', p_servicio_contratado_id;
  end if;
  -- Un borrador no cobra, y un cancelado o terminado no vuelve a cobrar.
  if v_contrato.estado <> 'activo' then
    raise exception 'enrolar_cobro_por_ciclo: el contrato % está en %, no en activo',
      p_servicio_contratado_id, v_contrato.estado;
  end if;

  -- Idempotencia: el acta ya existe.
  select e.plan_cobro_id into v_existente
    from public.servicio_cobro_enrolamiento e
   where e.servicio_contratado_id = p_servicio_contratado_id;
  if v_existente is not null then
    return jsonb_build_object('resultado', 'ya_estaba', 'plan_cobro_id', v_existente);
  end if;

  -- Un plan cargado a mano manda: no se le agrega otro encima.
  select p.id into v_existente
    from public.planes_cobro p
   where p.workspace_id = v_contrato.workspace_id
     and p.negocio_id = v_contrato.negocio_id
   limit 1;
  if v_existente is not null then
    return jsonb_build_object('resultado', 'plan_existente', 'plan_cobro_id', v_existente);
  end if;

  v_fin_trial := (p_ancla_at at time zone 'America/Bogota')::date + p_dias_trial;
  v_total := coalesce(jsonb_array_length(p_cuotas), 0);
  if v_total < 1 or v_total > 60 then
    raise exception 'enrolar_cobro_por_ciclo: el calendario trae % cuotas', v_total;
  end if;
  if (p_plan->>'total_cuotas')::integer is distinct from v_total then
    raise exception 'enrolar_cobro_por_ciclo: el plan dice % cuotas y el calendario trae %',
      p_plan->>'total_cuotas', v_total;
  end if;
  if (p_plan->>'fecha_inicio')::date is distinct from v_fin_trial then
    raise exception 'enrolar_cobro_por_ciclo: el plan arranca el % y el trial termina el %',
      p_plan->>'fecha_inicio', v_fin_trial;
  end if;

  -- El calendario, cuota por cuota: números 1..N consecutivos, montos positivos, vencimientos
  -- crecientes, y el PRIMERO el día en que termina el trial. Cobrar antes sería cobrar el trial.
  v_n := 0;
  for v_cuota in select * from jsonb_array_elements(p_cuotas) loop
    v_n := v_n + 1;
    if (v_cuota->>'numero')::integer is distinct from v_n then
      raise exception 'enrolar_cobro_por_ciclo: la cuota en la posición % dice número %',
        v_n, v_cuota->>'numero';
    end if;
    if coalesce((v_cuota->>'monto')::numeric, 0) <= 0 then
      raise exception 'enrolar_cobro_por_ciclo: la cuota % no tiene monto', v_n;
    end if;
    if v_n = 1 and (v_cuota->>'fecha_vencimiento')::date is distinct from v_fin_trial then
      raise exception
        'enrolar_cobro_por_ciclo: la cuota 1 vence el % y el trial termina el %: la primera cuota vence el día en que el trial termina',
        v_cuota->>'fecha_vencimiento', v_fin_trial;
    end if;
    if v_n > 1 and (v_cuota->>'fecha_vencimiento')::date
       <= (p_cuotas->(v_n - 2)->>'fecha_vencimiento')::date then
      raise exception 'enrolar_cobro_por_ciclo: la cuota % no vence después de la anterior', v_n;
    end if;
  end loop;

  v_monto := (p_plan->>'monto')::numeric;

  insert into public.planes_cobro (
    workspace_id, negocio_id, monto, frecuencia, fecha_inicio, fecha_fin, total_cuotas,
    pasarela, auto_renovar, activo, concepto_detalle_template, notas
  ) values (
    v_contrato.workspace_id,
    v_contrato.negocio_id,
    v_monto,
    coalesce(p_plan->>'frecuencia', 'mensual'),
    v_fin_trial,
    (p_plan->>'fecha_fin')::date,
    v_total,
    coalesce(p_plan->>'pasarela', 'manual'),
    false,
    -- Ver el encabezado: `activo = true` haría que el paso 4 del cron le emitiera cuentas de
    -- cobro. El enlace de pago (paso 6) no mira `activo`.
    false,
    p_plan->>'concepto_detalle_template',
    p_plan->>'notas'
  )
  returning id into v_plan_id;

  insert into public.plan_cobro_cuotas (
    workspace_id, plan_cobro_id, numero, tipo, monto, fecha_vencimiento, concepto_detalle
  )
  select
    v_contrato.workspace_id,
    v_plan_id,
    (c->>'numero')::integer,
    'cuota',
    (c->>'monto')::numeric,
    (c->>'fecha_vencimiento')::date,
    c->>'concepto_detalle'
  from jsonb_array_elements(p_cuotas) c;

  insert into public.servicio_cobro_enrolamiento (
    servicio_contratado_id, workspace_id, negocio_id, plan_cobro_id,
    ancla_at, dias_trial, fin_trial, monto, total_cuotas
  ) values (
    p_servicio_contratado_id, v_contrato.workspace_id, v_contrato.negocio_id, v_plan_id,
    p_ancla_at, p_dias_trial, v_fin_trial, v_monto, v_total
  );

  return jsonb_build_object('resultado', 'creado', 'plan_cobro_id', v_plan_id,
                            'fin_trial', v_fin_trial, 'total_cuotas', v_total);
exception
  -- Dos corridas simultáneas: la que pierde la carrera del PK no crea un segundo plan (su
  -- transacción entera se deshace) y reporta lo que ya existe.
  when unique_violation then
    select e.plan_cobro_id into v_existente
      from public.servicio_cobro_enrolamiento e
     where e.servicio_contratado_id = p_servicio_contratado_id;
    return jsonb_build_object('resultado', 'ya_estaba', 'plan_cobro_id', v_existente);
end;
$$;

comment on function public.enrolar_cobro_por_ciclo(uuid, timestamptz, integer, jsonb, jsonb) is
  'Crea el plan de cobro, sus cuotas y el acta de enrolamiento de un contrato por ciclo, en una transacción. Idempotente por la llave primaria del acta. Exige que la cuota 1 venza el día en que termina el trial.';

-- Solo el cron (service_role). Nada de `authenticated`: enrolar un contrato es escribir dinero, y
-- ninguna pantalla lo hace.
revoke execute on function public.enrolar_cobro_por_ciclo(uuid, timestamptz, integer, jsonb, jsonb)
  from public, anon, authenticated;
