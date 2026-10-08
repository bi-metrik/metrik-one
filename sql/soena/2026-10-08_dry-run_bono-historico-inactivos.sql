-- Dry-run de 20261008223000_bono_operaciones_historico_inactivos.sql (SOE-006) contra producción.
--
-- UN solo statement: lee el bono de septiembre y octubre de 2026 con la función VIVA, aplica la
-- migración (dos reemplazos de texto sobre pg_get_functiondef), los vuelve a leer y aborta con RAISE
-- EXCEPTION. Nada queda escrito: el resultado vuelve en el mensaje del error. Correrlo por MCP
-- execute_sql y después confirmar que la función sigue como estaba:
--   select md5(pg_get_functiondef('public.get_operaciones_bono_resumen(uuid,integer,integer)'::regprocedure));
--   -- 72fcf9e4fe10ee488c69dff97ab1f554
--
-- Lo que tiene que decir:
--   md5_antes = 72fcf9e4fe10ee488c69dff97ab1f554 (si no, la función cambió desde el brief)
--   jhon.bloques_sep ≈ 202 · jhon.en_sep_antes = false · jhon.en_sep_despues = true ·
--   jhon.en_oct_despues = false
--   activos_iguales_sep = true y oct_igual = true (las personas activas no mueven ni un peso)
--   supervisor_sep_igual = true: puntaje, promedios, aportes y bono del bloque `supervisor` de
--   septiembre idénticos antes y después (hoy: puntaje 0,6; promedios calidad 0,4 y radicación
--   0,2). El promedio cuenta solo a los activos, por decisión de Mauricio (2026-10-08): «En
--   septiembre Deisy debe mantenerse en la misma comisión. Por ahora no toquemos eso hasta que
--   ellos nos notifiquen en otro ticket cómo va a quedar.» Si da false, NO aplicar.
--   todo_ok = true resume las cinco condiciones de arriba.
--   comerciales_inactivos: lista de comerciales inactivos de SOENA y los meses (abr-sep) en que
--   get_comercial_resumen_soena los trae. Esa RPC no filtra is_active en el repo; si alguno
--   tiene ventas y no aparece, la versión viva sí filtra y hay que mirarla.
--
-- El cuerpo de la migración va pegado TAL CUAL entre $mig$ (generado, no transcrito). Si se
-- edita la migración, regenerar este archivo.

DO $dry$
DECLARE
  ws    uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  jhon  uuid := '587e3b1f-ba69-4c12-896f-08fa6c38de49';
  firma regprocedure := 'public.get_operaciones_bono_resumen(uuid,integer,integer)'::regprocedure;
  uid   uuid;
  md5_antes text;
  md5_despues text;
  sep_a jsonb; oct_a jsonb; sep_d jsonb; oct_d jsonb;
  bloques int;
  activos_iguales boolean;
  activos_n_antes int;
  activos_n_iguales int;
  sup_igual boolean;
  jhon_sep boolean;
  jhon_oct boolean;
  comerciales jsonb;
  r jsonb;
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

  md5_antes := md5(pg_get_functiondef(firma));
  sep_a := public.get_operaciones_bono_resumen(ws, 2026, 9);
  oct_a := public.get_operaciones_bono_resumen(ws, 2026, 10);

  SELECT count(*) INTO bloques
  FROM negocio_bloques nb
  JOIN negocios n ON n.id = nb.negocio_id AND n.workspace_id = ws
  JOIN staff s ON s.id = jhon
  WHERE nb.completado_por = s.profile_id
    AND nb.completado_at >= ('2026-09-01'::timestamp AT TIME ZONE 'America/Bogota')
    AND nb.completado_at <  ('2026-10-01'::timestamp AT TIME ZONE 'America/Bogota');

  EXECUTE $mig$
-- ============================================================
-- 20261008223000_bono_operaciones_historico_inactivos
-- ============================================================
-- SOE-006 (Deisy, SOENA). Regla de Mauricio (2026-10-08): «Siempre cuando inactivamos un
-- usuario, el histórico se debe mantener. Todos los indicadores los debemos poder trazar.»
--
-- `staff.is_active` es un estado de HOY. `get_operaciones_bono_resumen` armaba el universo de
-- personas con `WHERE s.is_active IS NOT FALSE`, así que retirar a alguien lo borraba de TODOS
-- los meses: Jhon Fredy Rios Varon (retirado por la pantalla el 1-oct, 202 bloques completados
-- en septiembre) dejó de aparecer en Operaciones → Personas, en /equipo y su hoja
-- `/equipo/operaciones/[staff_id]` respondía 404, que la busca dentro de este resumen.
--
-- Ahora una persona inactiva entra al mes consultado si tuvo ACTIVIDAD PROPIA en ese mes
-- (hora de Bogotá):
--   · completó un bloque de un negocio del workspace (`negocio_bloques.completado_por`, que
--     apunta a profiles.id), o
--   · movió un negocio de etapa (`activity_log` tipo 'cambio_etapa', `autor_id` apunta a
--     staff.id — al revés que el anterior, ver 20260901000006). Es el mismo hecho que alimenta
--     el indicador de correcciones. Un comentario suelto NO cuenta: no mide nada del bono y
--     metería a la persona al promedio del equipo con un puntaje sin casos.
-- Sin actividad en el mes, no aparece: el retirado desaparece de los meses posteriores a su
-- retiro. Las personas activas siguen entrando como antes (todo el área, con o sin casos).
-- Un reproceso que se le ATRIBUYE después de retirarse no lo vuelve a meter: eso no es
-- actividad suya en ese mes.
--
-- EL PROMEDIO DE QUIEN LIDERA NO CAMBIA (provisional). El bono del supervisor sale del promedio
-- del equipo (`prom`, sobre `final`). Si el retirado entrara a ese promedio, septiembre de 2026
-- bajaría de puntaje 0,6 a 0 (Jhon tiene calidad, radicación y correcciones en 0 y el piso del
-- director lo manda a cero). Decisión de Mauricio (2026-10-08): «En septiembre Deisy debe
-- mantenerse en la misma comisión. Por ahora no toquemos eso hasta que ellos nos notifiquen en
-- otro ticket cómo va a quedar.» Por eso `prom` cuenta SOLO a quienes hoy están activos
-- (`staff.is_active IS NOT FALSE`, el mismo universo de antes): el inactivo aparece en la lista de
-- personas con sus indicadores, pero no entra al promedio. Cuando SOENA defina la regla en otro
-- ticket, se revisa este filtro.
--
-- El rótulo «(inactivo)» junto al nombre lo pone el servidor (`src/lib/equipo/inactivos.ts`),
-- no esta función: así la forma del JSON no cambia.
--
-- ⚠️ POR QUÉ SOBRE `pg_get_functiondef` Y NO CON LA COPIA DEL REPO
-- En producción md5(pg_get_functiondef) = 72fcf9e4fe10ee488c69dff97ab1f554. La última versión
-- del repo (20260901000006), cargada tal cual en PGlite (PostgreSQL 18), da
-- d7f841b5ccf39ffccee74fb0a1d3e349. Puede ser solo formato de versión, pero no se pudo leer la
-- definición viva para descartarlo, y las RPC de SOENA ya han divergido del repo antes.
-- Reescribirla desde el repo podría revertir en silencio lo que haya cambiado allá. Se hacen DOS
-- reemplazos de texto sobre la definición viva (patrón de 20261007184500), y cada uno aborta si
-- su patrón no está exactamente una vez:
--   1. el filtro del universo `gente` (`WHERE s.is_active IS NOT FALSE`);
--   2. el cierre del promedio del supervisor (`FROM final f` + `) prom`; `FROM final f` sola
--      aparece dos veces, por eso se busca con el `) prom`).
-- `create or replace` (lo que trae pg_get_functiondef) conserva dueño, SECURITY DEFINER y
-- grants.
--
-- Idempotente por reemplazo: cada uno deja su marca (`SOE-006 universo`, `SOE-006 promedio`) y se
-- salta si ya está.
-- ============================================================

do $$
declare
  v_oid    oid;
  v_def    text;
  v_n      int;
  v_cambio boolean := false;
  -- 1. Universo `gente`
  v_viejo_u constant text := 'WHERE s.is_active IS NOT FALSE';
  v_nuevo_u constant text := $frag$WHERE (
      -- SOE-006 universo: is_active es un estado de HOY y no puede borrar un mes pasado. Quien
      -- hoy esta inactivo entra al mes si tuvo actividad propia en ese mes.
      s.is_active IS NOT FALSE
      OR EXISTS (
        SELECT 1
        FROM negocio_bloques nbx
        JOIN negocios nex ON nex.id = nbx.negocio_id AND nex.workspace_id = s.workspace_id
        WHERE s.profile_id IS NOT NULL
          AND nbx.completado_por = s.profile_id
          AND nbx.completado_at >= (make_date(p_anio, p_mes, 1)::timestamp AT TIME ZONE 'America/Bogota')
          AND nbx.completado_at <  ((make_date(p_anio, p_mes, 1) + interval '1 month')::timestamp AT TIME ZONE 'America/Bogota')
      )
      OR EXISTS (
        SELECT 1
        FROM activity_log alx
        WHERE alx.workspace_id = s.workspace_id
          AND alx.autor_id = s.id
          AND alx.tipo = 'cambio_etapa'
          AND alx.created_at >= (make_date(p_anio, p_mes, 1)::timestamp AT TIME ZONE 'America/Bogota')
          AND alx.created_at <  ((make_date(p_anio, p_mes, 1) + interval '1 month')::timestamp AT TIME ZONE 'America/Bogota')
      )
    )$frag$;
  -- 2. Promedio del supervisor
  v_viejo_p constant text := E'        FROM final f\n      ) prom';
  v_nuevo_p constant text := $frag$        FROM final f
        -- SOE-006 promedio (PROVISIONAL): solo quienes hoy estan activos, igual que antes de
        -- SOE-006. Decision de Mauricio (2026-10-08): "En septiembre Deisy debe mantenerse en la
        -- misma comision. Por ahora no toquemos eso hasta que ellos nos notifiquen en otro ticket
        -- como va a quedar." El inactivo sale en `personas`, pero no entra a este promedio.
        WHERE f.staff_id IN (SELECT sx.id FROM staff sx WHERE sx.is_active IS NOT FALSE)
      ) prom$frag$;
begin
  select p.oid into v_oid
  from pg_proc p
  where p.oid = 'public.get_operaciones_bono_resumen(uuid,integer,integer)'::regprocedure;

  v_def := pg_get_functiondef(v_oid);

  if position('SOE-006 universo' in v_def) > 0 then
    raise notice 'get_operaciones_bono_resumen ya trae SOE-006 universo: se salta';
  else
    v_n := (length(v_def) - length(replace(v_def, v_viejo_u, ''))) / length(v_viejo_u);
    if v_n <> 1 then
      raise exception 'get_operaciones_bono_resumen cambió en producción: el filtro "%" aparece % veces (se esperaba 1). Revisar a mano antes de aplicar.', v_viejo_u, v_n;
    end if;
    v_def := replace(v_def, v_viejo_u, v_nuevo_u);
    v_cambio := true;
  end if;

  if position('SOE-006 promedio' in v_def) > 0 then
    raise notice 'get_operaciones_bono_resumen ya trae SOE-006 promedio: se salta';
  else
    v_n := (length(v_def) - length(replace(v_def, v_viejo_p, ''))) / length(v_viejo_p);
    if v_n <> 1 then
      raise exception 'get_operaciones_bono_resumen cambió en producción: el cierre del promedio del supervisor aparece % veces (se esperaba 1). Revisar a mano antes de aplicar.', v_n;
    end if;
    v_def := replace(v_def, v_viejo_p, v_nuevo_p);
    v_cambio := true;
  end if;

  if v_cambio then
    execute v_def;
  end if;
end;
$$;
$mig$;

  md5_despues := md5(pg_get_functiondef(firma));
  sep_d := public.get_operaciones_bono_resumen(ws, 2026, 9);
  oct_d := public.get_operaciones_bono_resumen(ws, 2026, 10);

  -- Las personas que ya estaban antes tienen que salir idénticas, y TODAS (ninguna se cae).
  SELECT count(*) INTO activos_n_antes FROM jsonb_array_elements(sep_a->'personas');
  SELECT coalesce(bool_and(d.p = a.p), false), count(*) FILTER (WHERE d.p = a.p)
  INTO activos_iguales, activos_n_iguales
  FROM jsonb_array_elements(sep_a->'personas') a(p)
  JOIN jsonb_array_elements(sep_d->'personas') d(p) ON d.p->>'staff_id' = a.p->>'staff_id';
  activos_iguales := activos_iguales AND activos_n_iguales = activos_n_antes;

  -- El bloque de quien lidera, entero (puntaje, promedios, aportes, bono, completo).
  sup_igual := (sep_a->'supervisor') IS NOT DISTINCT FROM (sep_d->'supervisor');
  jhon_sep := EXISTS (SELECT 1 FROM jsonb_array_elements(sep_d->'personas') p WHERE p->>'staff_id' = jhon::text);
  jhon_oct := EXISTS (SELECT 1 FROM jsonb_array_elements(oct_d->'personas') p WHERE p->>'staff_id' = jhon::text);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'staff_id', s.id, 'nombre', s.full_name,
           'meses_con_fila', (
             SELECT coalesce(jsonb_agg(m ORDER BY m), '[]'::jsonb)
             FROM generate_series(4, 9) m
             WHERE EXISTS (
               SELECT 1 FROM jsonb_array_elements(coalesce(public.get_comercial_resumen_soena(ws, 2026, m), '[]'::jsonb)) x
               WHERE x->>'responsable_id' = s.id::text AND coalesce((x->>'num_ventas')::numeric, 0) > 0)),
           'negocios_responsable', (SELECT count(*) FROM negocios n WHERE n.workspace_id = ws AND n.responsable_id = s.id)
         )), '[]'::jsonb)
  INTO comerciales
  FROM staff s
  JOIN staff_areas sa ON sa.staff_id = s.id AND sa.area = 'comercial'
  WHERE s.workspace_id = ws AND s.is_active = false;

  r := jsonb_build_object(
    'todo_ok', md5_antes = '72fcf9e4fe10ee488c69dff97ab1f554' AND jhon_sep AND NOT jhon_oct
               AND activos_iguales AND oct_a = oct_d AND sup_igual,
    'md5_antes', md5_antes,
    'md5_despues', md5_despues,
    'jhon', jsonb_build_object(
      'bloques_sep', bloques,
      'en_sep_antes', EXISTS (SELECT 1 FROM jsonb_array_elements(sep_a->'personas') p WHERE p->>'staff_id' = jhon::text),
      'en_sep_despues', jhon_sep,
      'en_oct_despues', jhon_oct,
      'sep_despues', (SELECT p - 'bono' FROM jsonb_array_elements(sep_d->'personas') p WHERE p->>'staff_id' = jhon::text LIMIT 1)),
    'personas_sep_antes', (SELECT jsonb_agg(p->>'nombre') FROM jsonb_array_elements(sep_a->'personas') p),
    'personas_sep_despues', (SELECT jsonb_agg(p->>'nombre') FROM jsonb_array_elements(sep_d->'personas') p),
    'activos_iguales_sep', activos_iguales,
    'oct_igual', oct_a = oct_d,
    'supervisor_sep_igual', sup_igual,
    'supervisor_sep', jsonb_build_object(
      'antes', jsonb_build_object('nombre', sep_a->'supervisor'->'nombre', 'puntaje', sep_a->'supervisor'->'puntaje',
                                 'promedios', sep_a->'supervisor'->'promedios', 'aportes', sep_a->'supervisor'->'aportes',
                                 'bono', sep_a->'supervisor'->'bono'),
      'despues', jsonb_build_object('nombre', sep_d->'supervisor'->'nombre', 'puntaje', sep_d->'supervisor'->'puntaje',
                                   'promedios', sep_d->'supervisor'->'promedios', 'aportes', sep_d->'supervisor'->'aportes',
                                   'bono', sep_d->'supervisor'->'bono')),
    'comerciales_inactivos', comerciales);

  RAISE EXCEPTION 'DRYRUN %', jsonb_pretty(r);
END $dry$;
