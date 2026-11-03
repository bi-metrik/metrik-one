-- ============================================================
-- Resend Pro: correos suprimidos, rastro de los avisos internos y alarma de volumen
-- ------------------------------------------------------------
-- Tres cosas, las tres alimentadas por el webhook `resend-webhook`:
--
--   1. `avisos_cliente.estado` aprende `suprimido`: Resend aceptó el POST y NO lo mandó
--      porque el destinatario está en su lista de supresión (`email.suppressed`). Hasta hoy
--      esa fila quedaba `enviado`. `email.failed` NO necesita estado nuevo: va a `fallido`,
--      que ya significa «se intentó y el proveedor no lo mandó» (ver resend-acuses.ts).
--
--   2. `avisos_equipo`: la traza de los correos INTERNOS al equipo (notificar-etapa,
--      avisar-asignacion, alertas-plazo, recordatorios y la alarma de volumen). Tabla aparte y no filas en
--      `avisos_cliente` para no tocar su deduplicación por `huella` ni sus `negocio_id NOT
--      NULL`, y para que nadie cuente un aviso interno como «al cliente le avisamos».
--
--   3. El contador mensual de correos (Resend Pro incluye 50.000 al mes; el excedente se
--      cobra y no hay corte). Fuente: `email.sent` del webhook, porque el volumen no se puede
--      consultar por API y el SMTP del auth de Supabase no pasa por nuestro código.
--      · `resend_volumen_config`: UNA fila con el día de corte, los umbrales y lo incluido.
--        Es el único sitio donde viven (cambiarlos = un UPDATE, sin desplegar).
--      · `resend_volumen_mensual`: enviados y umbrales ya avisados por período.
--      · `resend_eventos_contados`: los `svix-id` ya contados (Resend reintenta con el mismo
--        id). Se purgan a los 7 días: Svix deja de reintentar a las ~27 h.
--      · `resend_contar_enviado(svix_id)`: cuenta de forma atómica y devuelve el umbral
--        recién cruzado UNA sola vez por umbral y período.
--      · `resend_volumen_desmarcar(periodo, umbral)`: si el correo de la alarma no salió, el
--        webhook devuelve el umbral a «sin avisar» para que el siguiente `email.sent` reintente.
--
-- Solo esquema y una fila de configuración en una tabla NUEVA. No toca filas existentes.
-- ============================================================

-- ── 1. avisos_cliente.estado: + suprimido ────────────────────────────────────
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.avisos_cliente'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%estado%'
  loop
    execute format('alter table public.avisos_cliente drop constraint %I', r.conname);
    n := n + 1;
  end loop;
  if n <> 1 then
    raise exception
      'Se esperaba exactamente 1 CHECK sobre avisos_cliente.estado y se encontraron %. Abortado sin tocar nada.', n;
  end if;
end $$;

alter table public.avisos_cliente
  add constraint avisos_cliente_estado_check
  check (estado in ('enviado', 'disparado', 'omitido', 'fallido', 'rebotado', 'diferido', 'suprimido'));

comment on column public.avisos_cliente.estado is
  'enviado = Resend acepto el POST (SOLO correo). disparado = SOLO WhatsApp, el proveedor recibio el disparo. omitido = la plataforma decidio no mandarlo, con su motivo (trabajo del equipo: falta un dato). fallido = el proveedor no lo mando: rechazo el POST, o lo acepto y despues fallo (email.failed, motivo resend_failed: ...) (trabajo nuestro). rebotado = el correo SALIO y el buzon del destinatario lo devolvio (trabajo del equipo: corregir la direccion). diferido = espera al siguiente dia habil. suprimido = Resend acepto el POST y NO lo mando porque el destinatario esta en su lista de supresion (email.suppressed; trabajo del equipo: otra direccion o sacarla de la lista).';

-- ── 2. avisos_equipo ─────────────────────────────────────────────────────────
create table if not exists public.avisos_equipo (
  id            uuid primary key default gen_random_uuid(),
  -- Null solo en los avisos que no son de un workspace (la alarma de volumen de Resend):
  -- esas filas no las lee nadie por RLS, solo service_role.
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  negocio_id    uuid references public.negocios(id) on delete set null,
  -- Quién lo mandó: 'notificar-etapa', 'avisar-asignacion', 'alertas-plazo', 'recordatorios',
  -- 'resend-volumen'. Texto libre a propósito (como `avisos_cliente.motivo`): un origen nuevo
  -- no debe exigir migración.
  origen        text not null,
  canal         text not null default 'email' check (canal in ('email')),
  estado        text not null check (estado in ('enviado', 'fallido', 'rebotado', 'suprimido')),
  -- Los correos a los que salió, separados por coma (un POST puede llevar varios `to`).
  destino       text,
  titulo        text,
  motivo        text,
  -- El id de Resend: la llave con la que el webhook casa entregado / rebotado / suprimido.
  proveedor_id  text,
  entregado_at  timestamptz,
  queja_at      timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.avisos_equipo is
  'Traza de los correos internos al equipo (avisos de etapa, de asignacion, de plazos, alarma de volumen). La escriben las edge functions con service_role y la actualiza resend-webhook por proveedor_id. Aparte de avisos_cliente a proposito: no participa de la deduplicacion por huella ni cuenta como aviso al cliente.';

create index if not exists avisos_equipo_proveedor_idx
  on public.avisos_equipo (proveedor_id) where proveedor_id is not null;
create index if not exists avisos_equipo_ws_fecha_idx
  on public.avisos_equipo (workspace_id, created_at desc);
create index if not exists avisos_equipo_negocio_idx
  on public.avisos_equipo (negocio_id, created_at desc) where negocio_id is not null;

alter table public.avisos_equipo enable row level security;

drop policy if exists avisos_equipo_select on public.avisos_equipo;
create policy avisos_equipo_select on public.avisos_equipo
  for select to authenticated
  using (workspace_id = (select current_user_workspace_id()));

-- Lectura por workspace, sin escritura desde el cliente (igual que avisos_cliente).
revoke all on public.avisos_equipo from public, anon, authenticated;
grant select on public.avisos_equipo to authenticated;

-- ── 3. Volumen mensual de Resend ─────────────────────────────────────────────
create table if not exists public.resend_volumen_config (
  id          boolean primary key default true check (id),
  -- Día del mes (hora de Bogotá) en que arranca el período. 1 = mes calendario. Todavía no
  -- se sabe si Resend reinicia la cuota el día 1 o en la fecha de facturación: si es la
  -- segunda, se cambia aquí. Hasta 28 para que exista en todos los meses.
  dia_corte   smallint not null default 1 check (dia_corte between 1 and 28),
  -- Umbrales que disparan la alarma, una vez cada uno por período.
  umbrales    integer[] not null default '{20000,40000,45000}',
  -- Correos incluidos en el plan (para el porcentaje del aviso).
  incluidos   integer not null default 50000 check (incluidos > 0),
  updated_at  timestamptz not null default now()
);

comment on table public.resend_volumen_config is
  'UNA fila. El dia de corte del periodo, los umbrales de la alarma y los correos incluidos en el plan de Resend. Cambiar aqui, no en el codigo.';

insert into public.resend_volumen_config (id) values (true) on conflict (id) do nothing;

create table if not exists public.resend_volumen_mensual (
  periodo            date primary key,
  enviados           integer not null default 0,
  umbrales_avisados  integer[] not null default '{}',
  actualizado_at     timestamptz not null default now()
);

comment on table public.resend_volumen_mensual is
  'Correos aceptados por Resend (email.sent) por periodo. periodo = fecha de inicio, en hora de Bogota, segun resend_volumen_config.dia_corte.';

create table if not exists public.resend_eventos_contados (
  svix_id      text primary key,
  recibido_at  timestamptz not null default now()
);

create index if not exists resend_eventos_contados_recibido_idx
  on public.resend_eventos_contados (recibido_at);

comment on table public.resend_eventos_contados is
  'Los svix-id de email.sent ya sumados al contador. Resend reintenta con el mismo id. Se purgan a los 7 dias.';

alter table public.resend_volumen_config   enable row level security;
alter table public.resend_volumen_mensual  enable row level security;
alter table public.resend_eventos_contados enable row level security;

-- server-only: las lee y escribe resend-webhook con service_role, a traves de las funciones de abajo.
revoke all on public.resend_volumen_config   from public, anon, authenticated;
-- server-only: idem.
revoke all on public.resend_volumen_mensual  from public, anon, authenticated;
-- server-only: idem.
revoke all on public.resend_eventos_contados from public, anon, authenticated;

-- El período que contiene un instante: el último `dia_corte` <= hoy (hora de Bogotá).
create or replace function public.resend_periodo_de(p_ahora timestamptz, p_dia_corte int)
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when extract(day from (p_ahora at time zone 'America/Bogota'))::int >= p_dia_corte
      then make_date(
        extract(year from (p_ahora at time zone 'America/Bogota'))::int,
        extract(month from (p_ahora at time zone 'America/Bogota'))::int,
        p_dia_corte)
    else (make_date(
        extract(year from (p_ahora at time zone 'America/Bogota'))::int,
        extract(month from (p_ahora at time zone 'America/Bogota'))::int,
        p_dia_corte) - interval '1 month')::date
  end;
$$;

-- server-only: la usa resend_contar_enviado.
revoke execute on function public.resend_periodo_de(timestamptz, int) from public, anon, authenticated;

create or replace function public.resend_contar_enviado(p_svix_id text, p_ahora timestamptz default now())
returns table (
  contado         boolean,
  periodo         date,
  periodo_fin     date,
  enviados        integer,
  incluidos       integer,
  umbral_cruzado  integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_cfg       public.resend_volumen_config%rowtype;
  v_periodo   date;
  v_n         integer;
  v_avisados  integer[];
  v_cruzados  integer[];
  v_umbral    integer;
begin
  if p_svix_id is null or btrim(p_svix_id) = '' then
    raise exception 'resend_contar_enviado: svix_id vacio';
  end if;

  -- Deduplicación: solo cuenta si el id es nuevo.
  insert into public.resend_eventos_contados (svix_id, recibido_at)
  values (p_svix_id, p_ahora)
  on conflict (svix_id) do nothing;

  if not found then
    return query select false, null::date, null::date, null::integer, null::integer, null::integer;
    return;
  end if;

  select * into v_cfg from public.resend_volumen_config where id;
  if not found then
    v_cfg.dia_corte := 1;
    v_cfg.umbrales  := '{20000,40000,45000}';
    v_cfg.incluidos := 50000;
  end if;

  v_periodo := public.resend_periodo_de(p_ahora, v_cfg.dia_corte);

  -- La suma es atómica: el upsert bloquea la fila del período hasta el final de la
  -- transacción, así que dos eventos simultáneos se ordenan y el segundo ve lo que el
  -- primero dejó en `umbrales_avisados`.
  insert into public.resend_volumen_mensual as m (periodo, enviados)
  values (v_periodo, 1)
  on conflict (periodo) do update
    set enviados = m.enviados + 1, actualizado_at = now()
  returning m.enviados, m.umbrales_avisados into v_n, v_avisados;

  select coalesce(array_agg(u order by u), '{}') into v_cruzados
    from unnest(v_cfg.umbrales) u
   where u <= v_n and not (u = any (v_avisados));

  if cardinality(v_cruzados) > 0 then
    -- Si se cruzan varios de golpe (se bajó un umbral a mitad de mes) se avisa solo el más
    -- alto y se dan todos por avisados.
    v_umbral := v_cruzados[cardinality(v_cruzados)];
    update public.resend_volumen_mensual
       set umbrales_avisados = (
             select array_agg(distinct x order by x) from unnest(v_avisados || v_cruzados) x)
     where resend_volumen_mensual.periodo = v_periodo;
  end if;

  -- Purga: Svix deja de reintentar a las ~27 h; 7 días sobra.
  delete from public.resend_eventos_contados where recibido_at < p_ahora - interval '7 days';

  return query select true, v_periodo, (v_periodo + interval '1 month')::date, v_n, v_cfg.incluidos, v_umbral;
end;
$$;

-- server-only: la llama resend-webhook con service_role.
revoke execute on function public.resend_contar_enviado(text, timestamptz) from public, anon, authenticated;

-- Devuelve un umbral a «sin avisar» cuando el correo de la alarma no salió.
create or replace function public.resend_volumen_desmarcar(p_periodo date, p_umbral integer)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.resend_volumen_mensual
     set umbrales_avisados = array_remove(umbrales_avisados, p_umbral)
   where periodo = p_periodo;
$$;

-- server-only: la llama resend-webhook con service_role.
revoke execute on function public.resend_volumen_desmarcar(date, integer) from public, anon, authenticated;
