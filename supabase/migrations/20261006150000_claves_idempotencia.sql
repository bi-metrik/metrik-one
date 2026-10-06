-- Que nada se guarde ni se envíe dos veces (brief del 2026-10-06, «doble guardado»).
--
-- POR QUÉ. Una misma intención puede llegar dos veces al servidor sin que nadie la repita a
-- propósito:
--   · Chromium reenvía UNA vez, por su cuenta, un POST cuyo socket reusado se cortó sin
--     respuesta (medido el 2026-10-06, `scripts/sw-piloto.e2e.mjs`). Las server actions son POST
--     y Next no las deduplica.
--   · «Reintentar» después de «No se confirmó» (#1037), el doble toque, dos pestañas.
--   · Vercel puede entregar un cron dos veces; medido: avisos `inactividad_*` en pares a menos
--     de 6 s en soena, trappvel y afi, y 2 pares `cobro_vencido` en advise.
--
-- QUÉ AGREGA (todo inerte hasta que el código lo use; el código sin esta tabla corre como hoy):
--   1. `claves_idempotencia`: una fila por intención (clave del navegador + acción + persona +
--      huella de los argumentos) con el resultado guardado, y una por candado (crons).
--   2. `tomar_candado(clave, segundos)`: toma un candado con vencimiento de forma ATÓMICA. Lo
--      usan los crons para no correr dos veces a la vez.
--   3. Un índice único parcial en `notificaciones` para los avisos que crean los crons: a lo
--      sumo uno PENDIENTE por (persona, tipo, entidad). Es la última barrera: aunque dos
--      corridas se crucen, la base rechaza la segunda fila.
--
-- QUÉ NO HACE: no borra ni fusiona los duplicados que ya existen. El índice solo mira filas
-- creadas DESDE que se aplica la migración (fecha fija en el predicado): los pares viejos no lo
-- hacen fallar y siguen ahí para que Mauricio decida. Consulta previa en el PR.
--
-- ESCALA: a 100 personas activas, del orden de 20-30 mil filas por día en `claves_idempotencia`
-- (una por escritura protegida). Viven 24 h las de acción y lo que dure el candado; el purgado
-- diario las mantiene en un día de tráfico.

-- ── 1. La tabla ─────────────────────────────────────────────────────────────────────────
-- server-only: la leen y escriben solo las server actions y los crons, con la llave de servicio.
-- Un usuario no puede ver ni fabricar el resultado guardado de otro.
create table if not exists public.claves_idempotencia (
  clave text primary key,
  ambito text not null check (ambito in ('accion', 'candado')),
  -- Nombre legible de la acción o el cron (para leer la tabla, no para decidir).
  nombre text not null,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  usuario_id uuid,
  estado text not null default 'en_curso' check (estado in ('en_curso', 'hecha', 'fallida')),
  resultado jsonb,
  creada_at timestamptz not null default now(),
  terminada_at timestamptz,
  vence_at timestamptz not null
);

comment on table public.claves_idempotencia is
  'Una fila por intención del usuario (server action protegida) o por candado (cron). '
  'Si la misma intención llega dos veces, la segunda recibe el resultado guardado sin ejecutar. '
  'Ver src/lib/idempotencia/.';

create index if not exists claves_idempotencia_vence_idx on public.claves_idempotencia (vence_at);

alter table public.claves_idempotencia enable row level security;
revoke all on public.claves_idempotencia from anon, authenticated;

-- ── 2. El candado ───────────────────────────────────────────────────────────────────────
-- Devuelve true si lo tomó (no existía o el anterior ya venció) y false si otro lo tiene.
-- Un solo INSERT ... ON CONFLICT: dos llamadas a la vez no pueden tomarlo las dos.
create or replace function public.tomar_candado(p_clave text, p_segundos integer)
returns boolean
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  with tomado as (
    insert into public.claves_idempotencia (clave, ambito, nombre, estado, vence_at)
    values (p_clave, 'candado', p_clave, 'en_curso', now() + make_interval(secs => greatest(p_segundos, 1)))
    on conflict (clave) do update
      set vence_at = excluded.vence_at, creada_at = now(), estado = 'en_curso', terminada_at = null
      where public.claves_idempotencia.ambito = 'candado'
        and public.claves_idempotencia.vence_at < now()
    returning 1
  )
  select exists (select 1 from tomado);
$$;

comment on function public.tomar_candado(text, integer) is
  'Toma un candado con vencimiento. true = es tuyo; false = otro lo tiene vigente. Atómico.';

revoke execute on function public.tomar_candado(text, integer) from public, anon, authenticated;
grant execute on function public.tomar_candado(text, integer) to service_role;

-- ── 3. Purgado diario ──────────────────────────────────────────────────────────────────
select cron.unschedule('purgar-claves-idempotencia')
 where exists (select 1 from cron.job where jobname = 'purgar-claves-idempotencia');

select cron.schedule(
  'purgar-claves-idempotencia',
  '20 9 * * *',
  $cron$delete from public.claves_idempotencia where vence_at < now() - interval '1 day';$cron$
);

-- ── 4. Un aviso pendiente por (persona, tipo, entidad) en los avisos de los crons ──────
-- Los crons ya preguntan «¿hay uno pendiente?» antes de insertar, pero dos corridas a la vez
-- preguntan las dos antes de que cualquiera inserte. Con el índice, la segunda fila choca
-- (23505) y el cron la cuenta como «ya existía».
--
-- `streak_roto` no tiene entidad: `coalesce` a un uuid fijo para que dos nulos choquen.
-- Solo filas creadas desde que se aplica: los pares que ya existen no hacen fallar la migración.
-- El corte es el momento de aplicar la migración (se escribe como constante en el predicado,
-- que no admite `now()`).
do $$
begin
  if not exists (select 1 from pg_class where relname = 'notificaciones_pendiente_unica_de_cron') then
    execute format($i$
      create unique index notificaciones_pendiente_unica_de_cron
        on public.notificaciones (
          destinatario_id,
          tipo,
          coalesce(entidad_id, '00000000-0000-0000-0000-000000000000'::uuid)
        )
        where estado = 'pendiente'
          and tipo in ('inactividad_oportunidad', 'inactividad_proyecto', 'streak_roto', 'cobro_vencido')
          and created_at >= %L::timestamptz
    $i$, now());
  end if;
end $$;
