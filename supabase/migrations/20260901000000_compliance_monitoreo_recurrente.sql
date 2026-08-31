-- Compliance — motor de monitoreo recurrente (R3)
--
-- Qué pidió Yessica (reunión 2026-08-18): que el sistema revalide solo y avise
-- únicamente cuando algo cambió. "Si tiene 10 reportes cuando yo lo acepté y
-- ahora vuelvo y lo reviso y tiene 20, entonces en teoría deberían no continuar
-- con ese proveedor."
--
-- ── Por qué hay tres tablas y no una ──────────────────────────────────────
--
-- 1. La CONFIG es del obligado: cuánto está dispuesto a gastar y hasta cuándo
--    puede seguir mirando a quien rechazó. Ninguna de las dos es decisión de
--    MéTRIK.
-- 2. El BARRIDO deja fila **haya o no delta**. Corrección expresa de Lucía al
--    alcance técnico (2026-08-24): "un barrido que no deja rastro cuando no hay
--    delta es un barrido que no se puede probar. Ante el supervisor, 'no
--    notifiqué porque no cambió' es indistinguible de 'no revisé'."
-- 3. Los ITEMS guardan qué pasó con cada contraparte, incluidas las que el tope
--    dejó afuera. Un tope que corta en silencio se lee como cobertura total.
--
-- ── El tope no tiene default, y eso es deliberado ─────────────────────────
--
-- El alcance de R3 dice "tope de consumo por workspace y periodo, con corte. No
-- opcional". La lectura fuerte de eso no es inventar un número: es que **sin
-- tope adoptado el motor no gasta**. `cupo_periodo` nace null y el barrido corre
-- en modo simulación —selecciona, cuenta y deja su fila— sin llamar a la fuente.
-- Sembrar un default sería MéTRIK eligiendo cuánto se le factura al cliente.
--
-- ── El horizonte de *Rechazadas* es un límite jurídico, no una perilla ────
--
-- Concepto de Emilio (2026-08-31, §3): mantener a una persona bajo re-consulta
-- permanente después de rechazarla es tratamiento después de agotada la
-- finalidad que lo autorizaba. El monitoreo se conserva **acotado**: horizonte
-- finito, salida del barrido al vencer, y su única salida legítima es habilitar
-- la re-evaluación, nunca alertar sobre la persona. Por eso el horizonte vive en
-- la configuración adoptada y por eso `habilita_reevaluacion` existe como
-- columna separada de `notificada`.

-- server-only: el tope de consumo y el horizonte de rechazadas los fija solo el
-- oficial de cumplimiento, por server actions que validan el rol. Ningun cliente
-- los lee ni los escribe directo. Mismo criterio que la periodicidad de R2.
create table if not exists compliance_monitoreo_config (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  -- Consultas facturables que el barrido puede gastar por mes calendario.
  -- NULL = el obligado todavia no lo adopto -> el motor corre sin gastar.
  cupo_periodo integer check (cupo_periodo is null or (cupo_periodo >= 1 and cupo_periodo <= 100000)),

  -- Meses desde el rechazo durante los que la contraparte sigue en el barrido.
  -- Sugerido 12; no hay numero normativo que citar, es criterio a adoptar.
  horizonte_rechazadas_meses integer not null default 12
    check (horizonte_rechazadas_meses >= 1 and horizonte_rechazadas_meses <= 120),

  adoptado_por uuid references auth.users(id),
  adoptado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id)
);

comment on table compliance_monitoreo_config is
  'R3: tope de consumo por periodo y horizonte de Rechazadas. Politica del obligado. cupo_periodo null = sin adoptar, el barrido corre en simulacion y no gasta.';

comment on column compliance_monitoreo_config.cupo_periodo is
  'Consultas facturables por mes calendario. Sin default a proposito: elegirlo seria decidir por el cliente cuanto le facturan.';

comment on column compliance_monitoreo_config.horizonte_rechazadas_meses is
  'Limite del §3 del concepto de Emilio (2026-08-31): pasado el plazo desde el rechazo, la contraparte sale del barrido.';

-- ── Bitácora del barrido ──────────────────────────────────────────────────

-- server-only: evidencia de cumplimiento. La escribe el cron con el service
-- client y la leen server actions que validan el rol del oficial. Que un cliente
-- pudiera escribirla la volveria inutil como prueba ante un supervisor.
create table if not exists compliance_barridos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  -- Dia civil Bogota con el que corrio. Se guarda aparte de `created_at` porque
  -- la seleccion se decide contra la fecha civil, no contra el instante UTC.
  dia date not null,
  modo text not null check (modo in ('simulacion', 'ejecucion')),

  -- Foto del tope en el momento de correr. Si manana el oficial lo cambia, este
  -- barrido sigue explicando por que corto donde corto.
  cupo_periodo integer,
  consumidas_periodo_antes integer not null default 0,

  candidatos integer not null default 0,
  ejecutadas integer not null default 0,
  diferidas integer not null default 0,
  con_delta integer not null default 0,
  notificadas integer not null default 0,
  fallidas integer not null default 0,
  corte_por_tope boolean not null default false,

  error_mensaje text,
  created_at timestamptz not null default now()
);

comment on table compliance_barridos is
  'R3: una fila por corrida del motor, haya o no delta. Correccion de Lucia 2026-08-24: silencio hacia el oficial no es silencio en el log.';

create index if not exists idx_barridos_workspace_dia
  on compliance_barridos(workspace_id, dia desc);

-- server-only: mismo criterio que el encabezado.
create table if not exists compliance_barrido_items (
  id uuid primary key default gen_random_uuid(),
  barrido_id uuid not null references compliance_barridos(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,

  documento_tipo text,
  documento_numero text,
  nombre text,

  -- Etiqueta de la bandeja con la que entro. Se guarda porque explica la
  -- prioridad con la que se le asigno cupo.
  etiqueta text not null check (etiqueta in
    ('vigilancia_continua', 'excepciones_vigentes', 'rechazadas')),
  motivo text not null check (motivo in ('vigencia_vencida', 'sin_vigencia')),

  consulta_anterior_id uuid references consultas_listas_dual(id) on delete set null,
  consulta_nueva_id uuid references consultas_listas_dual(id) on delete set null,

  matches_antes integer,
  matches_ahora integer,
  fuentes_nuevas text[],

  -- Se ejecuto de verdad, o el tope la dejo para la proxima.
  diferida boolean not null default false,
  delta boolean not null default false,

  -- Campanita. Solo *Excepciones vigentes* y la aparicion de hallazgo sobre una
  -- contraparte limpia.
  notificada boolean not null default false,

  -- Solo *Rechazadas*: dejo de estar reportada y la decision puede volver a
  -- mirarse. Separada de `notificada` a proposito: el fallo de Emilio prohibe
  -- que el resultado del barrido de una rechazada genere alerta sobre la persona.
  habilita_reevaluacion boolean not null default false,

  error_mensaje text,
  created_at timestamptz not null default now()
);

comment on table compliance_barrido_items is
  'R3: que paso con cada contraparte del barrido, incluidas las diferidas por el tope. Un tope que corta en silencio se lee como cobertura total.';

comment on column compliance_barrido_items.habilita_reevaluacion is
  'Rechazadas que dejaron de estar reportadas. NO notifica: limite (iii) del §3 del concepto de Emilio 2026-08-31.';

create index if not exists idx_barrido_items_barrido
  on compliance_barrido_items(barrido_id);

-- La bandeja pregunta "hay delta posterior a la liberacion vigente de esta
-- contraparte?". Sin este indice esa pregunta se vuelve un scan por workspace.
create index if not exists idx_barrido_items_premisa
  on compliance_barrido_items(workspace_id, documento_numero, created_at desc)
  where delta = true;

-- ── updated_at con trigger ────────────────────────────────────────────────

create or replace function tg_monitoreo_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Toda funcion nace ejecutable por PUBLIC y `anon` la alcanza por ahi.
revoke execute on function public.tg_monitoreo_touch() from public;
revoke execute on function public.tg_monitoreo_touch() from anon;

drop trigger if exists trg_monitoreo_touch on compliance_monitoreo_config;
create trigger trg_monitoreo_touch
  before update on compliance_monitoreo_config
  for each row execute function tg_monitoreo_touch();

-- ── RLS ───────────────────────────────────────────────────────────────────

alter table compliance_monitoreo_config enable row level security;
alter table compliance_barridos enable row level security;
alter table compliance_barrido_items enable row level security;

revoke all on compliance_monitoreo_config from anon, authenticated;
revoke all on compliance_barridos from anon, authenticated;
revoke all on compliance_barrido_items from anon, authenticated;

-- ── La campanita ──────────────────────────────────────────────────────────
--
-- Un solo tipo nuevo, no dos. Lo que cambia entre "apareció un hallazgo sobre
-- alguien que estaba limpio" y "cambió el supuesto sobre el que el oficial
-- firmó" viaja en `metadata` y en el texto; partirlo en dos tipos obligaria a
-- extender el CHECK cada vez que el motor aprende a distinguir un caso mas.
--
-- Lo que NUNCA genera notificación: *Rechazadas*. Un cambio sobre una
-- contraparte rechazada no sube a la campanita ni con delta (§3.iii del concepto
-- de Emilio). Esa restricción vive en `efectoDeDelta()` y está probada; acá solo
-- queda dicho para que nadie la reintroduzca desde la base.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'notificaciones_tipo_check'
      and pg_get_constraintdef(oid) like '%compliance_delta_contraparte%'
  ) then
    alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
    alter table public.notificaciones add constraint notificaciones_tipo_check
      check (tipo = any (array[
        'inactividad_oportunidad','handoff','asignacion_responsable','asignacion_colaborador',
        'mencion','streak_roto','inactividad_proyecto','proyecto_entregado','proyecto_cerrado',
        'cobro_vencido','cobro_proximo','plan_terminado','cuenta_cobro_pendiente_aprobacion',
        'cuenta_cobro_enviada','cuenta_cobro_envio_fallo','responsable_faltante_area',
        'negocio_cancelado','negocio_reabierto','negocio_reactivado','conciliacion_solicitada',
        'mencion_equipo','reproceso','negocio_en_etapa','precio_corregido',
        'devolucion_bloque','compliance_delta_contraparte'
      ]::text[]));
  end if;
end $$;
