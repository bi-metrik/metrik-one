-- ============================================================
-- 20261010113000_correcciones_etapa_retirada
-- ============================================================
-- SOE-006 (Deisy, SOENA: «los indicadores de Camila se vieron afectados»).
--
-- `activity_log` guarda el NOMBRE de la etapa en cada `cambio_etapa` (valor_anterior /
-- valor_nuevo), y las RPC lo resolvían contra el nombre que la etapa tiene HOY. El 7-oct
-- (SOE-001, #1067) la etapa 19 «Seguimiento» pasó a llamarse «Entrega a la DIAN». Desde ese
-- momento ninguna fila histórica «Envío → Seguimiento» encontraba su etapa, y el denominador de
-- Correcciones (casos que la persona saca de Envío hacia adelante) cayó a cero en agosto y
-- septiembre: «sin radicaciones», puntaje incompleto, bono bajo y el promedio del supervisor
-- en nulo.
--
-- ── Qué se eligió y por qué ──
--
-- Se descartó guardar el id u orden de la etapa en `activity_log`:
--   · hay al menos 9 escritores de `cambio_etapa` (server actions, correcciones, reproceso,
--     devolución, webhook); cambiarlos todos, o ponerle un trigger a la tabla más caliente de
--     ONE, para un dato que de todas formas necesitaría un mapa de nombres para la historia;
--   · el respaldo de la historia ES un mapa de nombres viejos, así que el mapa hace falta igual.
-- Lo que se hizo es ese mapa, pero mantenido por la BASE y no a mano:
--   1. `etapas_nombres_anteriores`: cada nombre que una etapa tuvo, con su etapa, su orden y
--      hasta cuándo fue suyo.
--   2. Un trigger en `etapas_negocio` lo llena solo al renombrar o borrar una etapa. El próximo
--      renombre ya no rompe nada sin que nadie tenga que acordarse.
--   3. `etapa_orden_registrada(linea, valor, momento)` traduce lo que dice `activity_log` al
--      orden de la etapa: primero el nombre que la etapa tenía EN ESE MOMENTO, después el
--      nombre (o el id) actual. Una etapa renombrada responde con su orden de hoy; una borrada,
--      con el orden que tenía al borrarse.
--   4. Semilla con los 4 renombres de SOENA anteriores al trigger, medidos en `activity_log`
--      (el último uso del nombre viejo y el primero del nuevo):
--        Radicación → Pago UPME          (8)  último 2026-07-06, nuevo desde 2026-07-08
--        Precobro   → Segundo cobro      (10) último 2026-09-02, nuevo desde 2026-09-03
--        Cobro      → Cartera            (11) último 2026-09-02, nuevo desde 2026-09-04
--        Seguimiento→ Entrega a la DIAN  (19) último 2026-10-06, nuevo desde 2026-10-07
--      «vigente_hasta» es la primera aparición del nombre nuevo: toda fila con el nombre viejo
--      es anterior a eso por construcción.
--
-- ── Regla de Correcciones ──
--
-- Una salida de Envío cuenta salvo que sea un RETROCESO: si el destino se resuelve a una etapa de
-- orden menor o igual, no cuenta; si se resuelve a una posterior, cuenta; si no se resuelve (un
-- nombre que ninguna etapa tuvo nunca), CUENTA. Una etapa que ya no existe no puede volver a
-- tumbar el conteo. Con la semilla, hoy no hay ningún destino sin resolver en SOENA (el dry-run lo
-- mide). El origen («Envío») también se resuelve por momento, así que renombrar Envío tampoco
-- rompe el indicador.
--
-- ── Otra métrica rota por #1067 ──
--
-- `get_directivo_soena`, «calificados» (negocios que superaron Validación): filtraba
-- `valor_anterior ilike '%validaci%'`, y desde el 7-oct eso también atrapa «Validación de
-- rechazo» (orden 22). Ahora es la salida de la PRIMERA etapa de la línea (Validación, orden 1),
-- resuelta por momento. Antes del 7-oct el filtro viejo solo tocaba «Validación», así que los
-- meses anteriores no cambian (el dry-run lo mide).
--
-- ── Por qué los reemplazos son sobre `pg_get_functiondef` ──
--
-- Las RPC de SOENA han divergido del repo (ver 20261008223000). Reescribirlas desde el repo podría
-- revertir en silencio lo que cambió allá. Se reemplazan fragmentos de texto sobre la definición
-- viva y cada reemplazo ABORTA si su patrón no aparece exactamente una vez. Idempotente: si la
-- función ya trae la marca `SOE-006 etapas retiradas`, se salta. `create or replace` conserva
-- dueño, SECURITY DEFINER y grants.
--
-- Escribe datos: crea una tabla y siembra 4 filas (solo si las etapas de SOENA existen con el
-- nombre esperado). No toca `activity_log` ni ninguna fila existente.
-- ============================================================

-- ── 1. Nombres anteriores de las etapas ──────────────────────────────────────

create table public.etapas_nombres_anteriores (
  id            uuid primary key default gen_random_uuid(),
  -- Sin llave foránea a propósito: si se borra la línea, sus etapas se borran en cascada y el
  -- trigger de abajo escribe aquí; una FK haría fallar ese borrado.
  linea_id      uuid not null,
  -- La etapa que tuvo el nombre. Null si la etapa ya no existe (se usa `orden`).
  etapa_id      uuid references public.etapas_negocio(id) on delete set null,
  nombre        text not null,
  -- Orden que tenía cuando dejó de llamarse así. Solo se usa si la etapa ya no existe.
  orden         integer not null,
  -- El nombre fue de esta etapa hasta este instante (exclusivo).
  vigente_hasta timestamptz not null default now(),
  origen        text not null check (origen in ('renombrada', 'eliminada', 'semilla')),
  created_at    timestamptz not null default now()
);

create index etapas_nombres_anteriores_linea_nombre_idx
  on public.etapas_nombres_anteriores (linea_id, nombre, vigente_hasta);

alter table public.etapas_nombres_anteriores enable row level security;
-- server-only: la leen solo funciones SECURITY DEFINER (las RPC de bono y Dirección) y la escribe
-- el trigger de `etapas_negocio`. Ningún cliente la consulta.

comment on table public.etapas_nombres_anteriores is
  'Nombres que una etapa tuvo antes (renombrada o borrada). activity_log guarda NOMBRES de etapa; '
  'esto permite resolver un cambio_etapa viejo a su etapa aunque hoy se llame distinto. '
  'Lo llena el trigger etapas_negocio_nombre_anterior. SOE-006.';

-- ── 2. Trigger: renombrar o borrar una etapa deja su nombre viejo ─────────────

create or replace function public.registrar_nombre_anterior_etapa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.nombre is not null and old.nombre is distinct from new.nombre then
      insert into public.etapas_nombres_anteriores (linea_id, etapa_id, nombre, orden, origen)
      values (old.linea_id, old.id, old.nombre, old.orden, 'renombrada');
    end if;
    return new;
  end if;

  -- DELETE (AFTER): la etapa ya no existe, queda solo su orden.
  if old.nombre is not null and old.linea_id is not null then
    insert into public.etapas_nombres_anteriores (linea_id, etapa_id, nombre, orden, origen)
    values (old.linea_id, null, old.nombre, old.orden, 'eliminada');
  end if;
  return old;
end;
$$;

revoke execute on function public.registrar_nombre_anterior_etapa() from public, anon, authenticated;

create trigger etapas_negocio_nombre_anterior
  after update of nombre or delete on public.etapas_negocio
  for each row execute function public.registrar_nombre_anterior_etapa();

-- ── 3. Resolver un nombre de activity_log al orden de su etapa ────────────────

create or replace function public.etapa_orden_registrada(p_linea_id uuid, p_valor text, p_momento timestamptz)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(
    -- El nombre que la etapa tenía en ese momento (el más próximo después del hecho).
    (select coalesce(e.orden, h.orden)
       from public.etapas_nombres_anteriores h
       left join public.etapas_negocio e on e.id = h.etapa_id
      where h.linea_id = p_linea_id
        and h.nombre = p_valor
        and h.vigente_hasta > p_momento
      order by h.vigente_hasta
      limit 1),
    -- El nombre de hoy (o el id: hay escritores que guardan el id de la etapa).
    (select e.orden
       from public.etapas_negocio e
      where e.linea_id = p_linea_id
        and (e.nombre = p_valor or e.id::text = p_valor)
      order by e.orden
      limit 1)
  )
$$;

-- Solo la usan las RPC SECURITY DEFINER de abajo, que corren como su dueño.
revoke execute on function public.etapa_orden_registrada(uuid, text, timestamptz) from public, anon, authenticated;

comment on function public.etapa_orden_registrada(uuid, text, timestamptz) is
  'Orden de la etapa que un cambio_etapa de activity_log nombra (valor_anterior/valor_nuevo), '
  'resolviendo el nombre que la etapa tenía en ese momento. Null si ninguna etapa de la línea lo '
  'tuvo nunca. SOE-006.';

-- ── 4. Semilla: los renombres de SOENA anteriores al trigger ──────────────────
-- Solo si la etapa existe con el nombre de hoy esperado; en otro entorno no hace nada.

insert into public.etapas_nombres_anteriores (linea_id, etapa_id, nombre, orden, vigente_hasta, origen)
select e.linea_id, e.id, s.nombre_viejo, e.orden, s.hasta, 'semilla'
from (values
  ('fd0fcaf3-5547-4a16-85e2-5e0f5845c7c2'::uuid, 'Radicación',  'Pago UPME',         '2026-07-08 20:22:59.168549+00'::timestamptz),
  ('5cf7887c-c65f-470e-b9b7-bd9c253bfd03'::uuid, 'Precobro',    'Segundo cobro',     '2026-09-03 12:52:26.498045+00'::timestamptz),
  ('0be50010-a636-4b35-9938-eec26892a108'::uuid, 'Cobro',       'Cartera',           '2026-09-04 22:44:23.042658+00'::timestamptz),
  ('3f2a9c6e-5d41-4b8a-9e13-7c0d2a84b501'::uuid, 'Seguimiento', 'Entrega a la DIAN', '2026-10-07 19:16:29.839003+00'::timestamptz)
) as s(etapa_id, nombre_viejo, nombre_hoy, hasta)
join public.etapas_negocio e on e.id = s.etapa_id and e.nombre = s.nombre_hoy
where not exists (
  select 1 from public.etapas_nombres_anteriores x
  where x.etapa_id = s.etapa_id and x.nombre = s.nombre_viejo
);

-- ── 5. Bono de operaciones: Correcciones (resumen y detalle) ──────────────────
-- Por función, tres reemplazos, cada uno exactamente una vez:
--   a. `etapa_radicacion` expone también la línea de la etapa;
--   b. el origen se resuelve por momento en vez de por el nombre de hoy;
--   c. el EXISTS «destino de orden mayor por nombre de hoy» pasa a «no es un retroceso».

do $$
declare
  v_firmas  text[] := array[
    'public.get_operaciones_bono_resumen(uuid,integer,integer)',
    'public.get_operaciones_bono_detalle(uuid,integer,integer)'
  ];
  -- El EXISTS solo difiere en la tabla que acota el workspace.
  v_guardas text[] := array[
    'JOIN guard g2          ON g2.id = l2.workspace_id',
    'JOIN persona pe2       ON pe2.workspace_id = l2.workspace_id'
  ];
  v_viejo_a constant text := E'SELECT e.nombre, e.orden\n    FROM etapas_negocio e';
  v_nuevo_a constant text := E'SELECT e.nombre, e.orden, e.linea_id\n    FROM etapas_negocio e';
  v_viejo_b constant text := 'ON er.nombre = al.valor_anterior';
  v_nuevo_b constant text := 'ON public.etapa_orden_registrada(er.linea_id, al.valor_anterior, al.created_at) = er.orden';
  v_viejo_c text;
  v_nuevo_c constant text := $frag$-- SOE-006 etapas retiradas: cuenta toda salida de Envio que no sea un retroceso. El
      -- destino se resuelve con el nombre que la etapa tenia en ese momento (Seguimiento ->
      -- Entrega a la DIAN); uno que ninguna etapa tuvo nunca no tumba el conteo.
      AND al.valor_nuevo IS NOT NULL
      AND COALESCE(public.etapa_orden_registrada(er.linea_id, al.valor_nuevo, al.created_at) > er.orden, true)$frag$;
  v_def     text;
  v_n       int;
  i         int;
begin
  for i in 1 .. array_length(v_firmas, 1) loop
    v_def := pg_get_functiondef(v_firmas[i]::regprocedure);

    if position('SOE-006 etapas retiradas' in v_def) > 0 then
      raise notice '% ya trae SOE-006 etapas retiradas: se salta', v_firmas[i];
      continue;
    end if;

    v_viejo_c := E'AND EXISTS (\n'
              || E'        SELECT 1\n'
              || E'        FROM etapas_negocio e2\n'
              || E'        JOIN lineas_negocio l2 ON l2.id = e2.linea_id\n'
              || E'        ' || v_guardas[i] || E'\n'
              || E'        WHERE e2.nombre = al.valor_nuevo AND e2.orden > er.orden\n'
              || E'      )';

    v_n := (length(v_def) - length(replace(v_def, v_viejo_a, ''))) / length(v_viejo_a);
    if v_n <> 1 then
      raise exception '% cambió en producción: la etapa de radicación aparece % veces (se esperaba 1). Revisar a mano.', v_firmas[i], v_n;
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_viejo_b, ''))) / length(v_viejo_b);
    if v_n <> 1 then
      raise exception '% cambió en producción: "%" aparece % veces (se esperaba 1). Revisar a mano.', v_firmas[i], v_viejo_b, v_n;
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_viejo_c, ''))) / length(v_viejo_c);
    if v_n <> 1 then
      raise exception '% cambió en producción: el EXISTS del destino aparece % veces (se esperaba 1). Revisar a mano.', v_firmas[i], v_n;
    end if;

    v_def := replace(v_def, v_viejo_a, v_nuevo_a);
    v_def := replace(v_def, v_viejo_b, v_nuevo_b);
    v_def := replace(v_def, v_viejo_c, v_nuevo_c);
    execute v_def;
  end loop;
end;
$$;

-- ── 6. Dirección SOENA: «calificados» ─────────────────────────────────────────

do $$
declare
  v_firma   constant text := 'public.get_directivo_soena(uuid,integer,integer)';
  v_viejo   constant text := E'    and a.valor_anterior ilike \'%validaci%\'\n';
  v_nuevo   constant text := $frag$    -- SOE-006 etapas retiradas: «superó Validación» es salir de la PRIMERA etapa de la linea,
    -- resuelta con el nombre que tenia en ese momento. El ilike '%validaci%' de antes, desde el
    -- 7-oct, tambien atrapaba «Validación de rechazo» (orden 22).
    and exists (
      select 1
      from etapas_negocio ev
      join lineas_negocio lv on lv.id = ev.linea_id
      where lv.workspace_id = g.id
        and ev.orden = (select min(e1.orden) from etapas_negocio e1 where e1.linea_id = ev.linea_id)
        and public.etapa_orden_registrada(ev.linea_id, a.valor_anterior, a.created_at) = ev.orden
    )
$frag$;
  v_def     text;
  v_n       int;
begin
  v_def := pg_get_functiondef(v_firma::regprocedure);

  if position('SOE-006 etapas retiradas' in v_def) > 0 then
    raise notice '% ya trae SOE-006 etapas retiradas: se salta', v_firma;
    return;
  end if;

  v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  if v_n <> 1 then
    raise exception '% cambió en producción: el filtro de calificados aparece % veces (se esperaba 1). Revisar a mano.', v_firma, v_n;
  end if;

  execute replace(v_def, v_viejo, v_nuevo);
end;
$$;
