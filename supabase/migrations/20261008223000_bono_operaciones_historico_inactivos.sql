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
