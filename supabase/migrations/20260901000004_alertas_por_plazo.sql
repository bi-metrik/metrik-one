-- ============================================================
-- Alertas por PLAZO: avisar cuando se cumplen N dias habiles desde una fecha
--
-- EL PROBLEMA QUE CIERRA (SOENA, devolucion de IVA ante la DIAN):
--   El cliente radica su solicitud de devolucion. A partir de ese dia corren dos
--   relojes que nadie en la plataforma esta contando: a los 15 dias habiles puede
--   llegar el auto inadmisorio, y a los 50 dias habiles deberia llegar la plata.
--   Operaciones se entera cuando el cliente llama, no antes. Medido el 2026-08-31:
--   141 negocios abiertos en Seguimiento y CERO forma de saber cual esta vencido.
--
-- POR QUE UN MOTOR NUEVO Y NO `avisar_al_entrar`:
--   Todo lo que existe hoy dispara al ENTRAR a una etapa (trigger sobre `negocios`
--   -> `notificar-etapa`). Aqui el evento no es entrar a ningun lado: es que pase
--   el tiempo estando quieto. Un trigger no puede verlo; hace falta que alguien
--   pregunte todos los dias. De ahi el cron.
--
-- POR QUE CONFIG POR LINEA Y NO SOENA EN DURO:
--   La forma "fecha ancla + N dias habiles -> avisale a estas areas" no tiene nada
--   de SOENA. La linea declara sus hitos en `config_extra.alertas_plazo` y el motor
--   los lee; otra linea con otro tramite reusa esto sin tocar codigo. Lo unico que
--   SOENA aporta es la configuracion, que va en su propia migracion de proyecto.
--
-- ⚠️ LIMITE CONOCIDO: `festivos_colombia` solo tiene 2026 y 2027 cargados. Sin las
--   filas de un anio, los festivos de ese anio se cuentan como habiles y el aviso
--   sale ANTES de tiempo. `dias_habiles_entre` no puede adivinarlo: por eso
--   `plazos_pendientes` devuelve `festivos_cargados` y quien lea el resultado sabe
--   si puede confiar en la cuenta.
-- ============================================================

-- ── Aritmetica de dias habiles ─────────────────────────────────────────────
--
-- POR QUE NO SE REUSA `horas_habiles_entre`: esa funcion resta 24 h por cada dia
-- no habil sobre un total de horas de reloj, que es lo correcto para medir un SLA
-- de etapa (empieza a una hora concreta). Un plazo legal no cuenta horas: cuenta
-- DIAS de calendario habil, y el dia de la radicacion no cuenta (el plazo corre
-- desde el dia siguiente). Dividir horas entre 24 daria el numero equivocado en
-- los bordes, que es justo donde se decide si el aviso sale hoy o manana.

create or replace function public.dias_habiles_entre(d_desde date, d_hasta date)
returns integer
language sql
stable
set search_path to 'public'
as $$
  select case
    when d_desde is null or d_hasta is null or d_hasta <= d_desde then 0
    else (
      select count(*)::integer
      from generate_series(d_desde + 1, d_hasta, interval '1 day') as g(d)
      where extract(isodow from g.d) < 6
        and not exists (select 1 from public.festivos_colombia f where f.fecha = g.d::date)
    )
  end;
$$;

-- Las tres funciones de abajo las usa el motor server-side; ninguna es RPC del navegador.
revoke execute on function public.dias_habiles_entre(date, date) from public, anon;

comment on function public.dias_habiles_entre(date, date) is
  'Dias habiles en (d_desde, d_hasta]: excluye sabado, domingo y festivos_colombia. El dia inicial NO cuenta, que es como corren los plazos ante la DIAN.';

create or replace function public.sumar_dias_habiles(d_desde date, n_dias integer)
returns date
language plpgsql
stable
set search_path to 'public'
as $$
declare
  d date := d_desde;
  restantes integer := greatest(coalesce(n_dias, 0), 0);
begin
  if d_desde is null then return null; end if;
  -- Tope de seguridad: sin el, un `n_dias` disparatado deja el cron girando.
  if restantes > 3650 then raise exception 'sumar_dias_habiles: n_dias fuera de rango (%)', n_dias; end if;
  while restantes > 0 loop
    d := d + 1;
    if extract(isodow from d) < 6
       and not exists (select 1 from public.festivos_colombia f where f.fecha = d) then
      restantes := restantes - 1;
    end if;
  end loop;
  return d;
end;
$$;

revoke execute on function public.sumar_dias_habiles(date, integer) from public, anon;

comment on function public.sumar_dias_habiles(date, integer) is
  'Suma N dias habiles a una fecha, saltando fines de semana y festivos_colombia.';

-- ── Lectura segura de una fecha escrita a mano ─────────────────────────────
--
-- POR QUE EXISTE: los campos de fecha de los bloques se guardan como TEXTO dentro
-- de `negocio_bloques.data`. Medido el 2026-08-31 en SOENA, de las 3 casillas con
-- algo escrito DOS traen el anio en dos digitos: '0006-02-18' y '0026-08-28'.
-- Postgres las acepta como fechas validas del anio 6 y del anio 26, asi que un
-- `::date` desnudo no falla: calcula un plazo de dos mil anios y manda el aviso.
-- Cualquier cosa fuera de [2020, 2100] no es una fecha, es un error de digitacion,
-- y vale mas no contar ese caso que contarlo mal.

create or replace function public.fecha_de_texto(t text)
returns date
language sql
immutable
as $$
  select case
    when t ~ '^\d{4}-\d{2}-\d{2}'
     and substring(t from 1 for 4)::integer between 2020 and 2100
    then substring(t from 1 for 10)::date
    else null
  end;
$$;

revoke execute on function public.fecha_de_texto(text) from public, anon;

comment on function public.fecha_de_texto(text) is
  'Convierte a date el texto de un campo de bloque, o NULL si no es una fecha creible (anio fuera de 2020-2100). Blinda contra el anio escrito en dos digitos.';

-- ── Que ya se aviso ────────────────────────────────────────────────────────
--
-- POR QUE UNA TABLA Y NO UN CAMPO EN EL NEGOCIO: el cron corre todos los dias y
-- la condicion "lleva mas de 50 dias habiles" sigue siendo cierta manana. Sin
-- memoria, operaciones recibe el mismo caso cada manana hasta que alguien lo cierre,
-- y un correo que se repite se convierte en un correo que no se lee. La UNIQUE es
-- el mecanismo: el insert es el que gana la carrera, no una consulta previa.

create table if not exists public.alertas_plazo_log (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hito text not null,
  fecha_ancla date not null,
  ancla_origen text not null,
  dias_habiles integer not null,
  destinatarios text[] not null default '{}',
  enviado_at timestamptz not null default now(),
  constraint alertas_plazo_log_unico unique (negocio_id, hito)
);

comment on table public.alertas_plazo_log is
  'Un aviso de plazo por negocio y por hito, para siempre. La UNIQUE es lo que impide que el cron repita el mismo correo cada dia.';
comment on column public.alertas_plazo_log.ancla_origen is
  'De donde salio la fecha que arranco el reloj: "declarada" (alguien la escribio) o "estimada" (derivada de otra fecha). Va en el correo para que nadie confunda un estimado con un hecho.';

create index if not exists idx_alertas_plazo_log_negocio on public.alertas_plazo_log(negocio_id);
create index if not exists idx_alertas_plazo_log_ws_fecha on public.alertas_plazo_log(workspace_id, enviado_at desc);

alter table public.alertas_plazo_log enable row level security;

-- Escribe SOLO la edge function con service_role (que no pasa por RLS). El equipo
-- lo LEE dentro de su workspace: sin lectura, "¿a este ya le avisamos?" vuelve a
-- ser una pregunta sin respuesta, que es el problema que esto viene a cerrar.
drop policy if exists alertas_plazo_log_select on public.alertas_plazo_log;
create policy alertas_plazo_log_select on public.alertas_plazo_log
  for select to authenticated
  using (workspace_id = (select public.current_user_workspace_id()));

-- Lee el equipo desde la app; escribe solo la edge function con service_role (no pasa por RLS).
grant select on public.alertas_plazo_log to authenticated;
revoke insert, update, delete on public.alertas_plazo_log from authenticated;

-- ── Quien esta vencido hoy ─────────────────────────────────────────────────
--
-- Devuelve los negocios de una linea que YA cumplieron un hito y a los que todavia
-- no se les ha avisado. La linea declara los hitos; esta funcion no sabe nada de
-- IVA ni de la DIAN.
--
-- Forma de `lineas_negocio.config_extra.alertas_plazo`:
--   {
--     "areas": ["operaciones"],
--     "etapas_orden": [19],
--     "ancla": { "campo": "fecha_radicacion_dian",
--                "fallback_campo": "fecha_cita_dian",
--                "fallback_dias_habiles": 5 },
--     "cerrar_si": { "campo": "fecha_devolucion_dian" },
--     "hitos": [ {"slug": "...", "dias_habiles": 15, "titulo": "..."} ]
--   }
--
-- POR QUE UN FALLBACK PARA EL ANCLA: la fecha que de verdad importa es la de la
-- radicacion, y hoy no la captura nadie. Sin fallback, el aviso no existiria hasta
-- que el equipo empiece a escribirla, y el caso viejo seguiria invisible. Con el,
-- el reloj arranca desde una estimacion util (la cita mas los dias que tarda la
-- radicacion) y se corrige solo el dia que alguien escriba la fecha real. El correo
-- dice cual de las dos uso.

create or replace function public.plazos_pendientes(p_linea_id uuid)
returns table (
  negocio_id uuid,
  workspace_id uuid,
  codigo text,
  nombre text,
  etapa text,
  hito text,
  hito_titulo text,
  dias_habiles integer,
  fecha_ancla date,
  ancla_origen text,
  dias_transcurridos integer,
  festivos_cargados boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with cfg as (
    select l.workspace_id as ws,
           l.config_extra->'alertas_plazo' as c
    from lineas_negocio l
    where l.id = p_linea_id
      and l.config_extra ? 'alertas_plazo'
  ),
  hitos as (
    select (h->>'slug')::text as slug,
           (h->>'titulo')::text as titulo,
           (h->>'dias_habiles')::integer as dias
    from cfg, jsonb_array_elements(cfg.c->'hitos') as h
  ),
  candidatos as (
    select n.id, n.workspace_id, n.codigo, n.nombre, e.nombre as etapa
    from negocios n
    join etapas_negocio e on e.id = n.etapa_actual_id
    cross join cfg
    where n.estado = 'abierto'
      and e.linea_id = p_linea_id
      and e.orden in (
        select (v)::text::integer from jsonb_array_elements(cfg.c->'etapas_orden') as v
      )
  ),
  -- El valor de un campo puede vivir en cualquier casilla del negocio: se toma el
  -- primero legible, no el primero que exista, para que una casilla con el anio
  -- mal escrito no tape a otra que si esta bien.
  ancla as (
    select c.id,
           max(fecha_de_texto(nb.data->>(cfg.c->'ancla'->>'campo'))) as declarada,
           max(fecha_de_texto(nb.data->>(cfg.c->'ancla'->>'fallback_campo'))) as fallback
    from candidatos c
    cross join cfg
    left join negocio_bloques nb on nb.negocio_id = c.id
    group by c.id
  ),
  cerrados as (
    select distinct nb.negocio_id
    from negocio_bloques nb
    cross join cfg
    where cfg.c ? 'cerrar_si'
      and fecha_de_texto(nb.data->>(cfg.c->'cerrar_si'->>'campo')) is not null
  ),
  resuelto as (
    select c.id, c.workspace_id, c.codigo, c.nombre, c.etapa,
           coalesce(
             a.declarada,
             sumar_dias_habiles(a.fallback, (cfg.c->'ancla'->>'fallback_dias_habiles')::integer)
           ) as fecha_ancla,
           case when a.declarada is not null then 'declarada' else 'estimada' end as origen
    from candidatos c
    join ancla a on a.id = c.id
    cross join cfg
    where c.id not in (select negocio_id from cerrados)
  )
  select r.id, r.workspace_id, r.codigo, r.nombre, r.etapa,
         h.slug, h.titulo, h.dias,
         r.fecha_ancla, r.origen,
         dias_habiles_entre(r.fecha_ancla, current_date),
         exists (
           select 1 from festivos_colombia f
           where extract(year from f.fecha) = extract(year from current_date)
         )
  from resuelto r
  cross join hitos h
  where r.fecha_ancla is not null
    and dias_habiles_entre(r.fecha_ancla, current_date) >= h.dias
    and not exists (
      select 1 from alertas_plazo_log g
      where g.negocio_id = r.id and g.hito = h.slug
    )
  order by r.fecha_ancla, r.codigo;
$$;

comment on function public.plazos_pendientes(uuid) is
  'Negocios de una linea que cumplieron un hito de plazo y no han sido avisados. Los hitos los declara la linea en config_extra.alertas_plazo.';

-- La invoca la edge function con service_role. Nadie mas: devuelve filas de un
-- workspace resuelto por la linea, no por la sesion.
revoke execute on function public.plazos_pendientes(uuid) from public, anon, authenticated;
