-- ============================================================
-- Los dos crons que nadie invoca desde el cliente dejan de ser ejecutables por `authenticated`
--
-- ## DE DONDE VIENE EL GRANT
--
-- 20260630000001 (security ola 2) revoco `EXECUTE` a `anon` en 45 funciones SECURITY
-- DEFINER y CONSERVO `authenticated` en 24. El criterio declarado fue "las RPC que invoca
-- el cliente, mas las que usan las policies RLS" -- y ese criterio es correcto: revocar una
-- funcion que una policy invoca rompe el aislamiento por workspace.
--
-- `detectar_responsable_faltante_area()` y `cleanup_expired_bloque_locks()` entraron en ese
-- lote y NO son ninguna de las dos cosas. Son crons. Medido el 2026-09-02, cuatro fuentes
-- independientes, las cuatro coinciden:
--
--   repo                 0 consumidores en src/, supabase/functions/ y scripts/.
--                        ⚠️ La unica ocurrencia en `src/` es `src/types/database.ts`, que es
--                        AUTOGENERADO y lista todas las funciones: contarlo da un falso
--                        "tiene consumidor" para cualquier funcion de la base.
--   catalogo             0 policies, 0 triggers, 0 funciones que las invoquen.
--   pg_cron              1 cada una: jobid 9 (13:00 UTC) y jobid 8 (cada 15 min), ambos
--                        `active` y corriendo como `postgres`.
--   pg_stat_statements   0 llamadas de `authenticated`. `cleanup` acumula 138 y
--                        `detectar` 2 (el cron mas un ensayo con rollback), TODAS de
--                        `postgres`.
--
-- Ese cero tiene denominador, que es lo que lo vuelve informativo: en la MISMA ventana el
-- rol `authenticated` acumulo 202.682 llamadas en 344 queries distintas. Si un cliente las
-- invocara, apareceria. La ventana solo cubre 34 h (stats_reset 2026-08-31 16:28), asi que
-- no descarta un uso mensual; lo que cubre el tiempo largo es que ningun codigo del repo
-- las nombra, en ninguna version desplegada.
--
-- ## QUE CONCEDIA CADA UNA, SIN INFLARLO
--
-- Ninguna de las dos devuelve datos: retornan un `integer`. Lo que conceden es ESCRITURA,
-- y en grados muy distintos:
--
--   `detectar_responsable_faltante_area`  No acota por workspace: barre los 7 y sus 472
--       negocios abiertos. Un autenticado de cualquier tenant podia forzar la creacion de
--       avisos fuera de horario en todos. Acotado por dos hechos medidos: tiene dedup
--       (`v_existing`), y ni `crear_notificacion` ni la tabla `notificaciones` disparan
--       `http_post`, asi que no amplifica por correo.
--
--   `cleanup_expired_bloque_locks`  Es `delete from bloque_locks where expires_at < now()`:
--       solo lo YA vencido. Un autenticado adelantaba una limpieza que el cron hace cada 15
--       minutos. El efecto es practicamente nulo; se revoca por consistencia del criterio,
--       no porque hubiera riesgo.
--
-- ## POR QUE HAY QUE NOMBRAR `authenticated`
--
-- Igual que en 20260902000002: el `ALTER DEFAULT PRIVILEGES` de esta base concede EXECUTE
-- de forma EXPLICITA a `anon`, `authenticated` y `service_role` sobre toda funcion nueva de
-- `public`, asi que `authenticated=X/postgres` es un grant propio y no herencia de PUBLIC
-- (gotcha #185). Revocar PUBLIC cierra la herencia; el default explicito se revoca aparte.
--
-- ## QUE NO SE TOCA, Y POR QUE
--
-- De las 8 funciones SECURITY DEFINER ejecutables por `authenticated` que no tienen ningun
-- consumidor en `src/`, CINCO son helpers que las policies RLS invocan, y ahi el grant es
-- NECESARIO -- revocarlas rompe el aislamiento por workspace:
--
--   calidad_ve_todo_el_piso     5 policies
--   current_user_profile_role   3 policies
--   calidad_llamada_es_mia      2 policies
--   current_user_staff_id       1 policy
--   is_admin_or_owner           1 policy
--
-- ⚠️ HALLAZGO ABIERTO, no se toca aqui: `get_user_role()` quedo con 0 policies, 0 crons, 0
-- funciones que la llamen y 0 consumidores en `src/`. CLAUDE.md la lista entre las tres
-- SECURITY DEFINER "intocables", y esa premisa ya no se sostiene. Ademas devuelve el
-- vocabulario de `staff.rol_plataforma` (`ejecutor`, `dueno`), no el de `profiles.role`
-- (`operator`, `owner`), asi que cualquier autorizacion escrita con ella no coincide nunca
-- salvo con `supervisor`, donde los dos vocabularios se cruzan. Merece su propia medicion.
--
-- No toca ninguna fila de datos ni ninguna definicion de funcion: solo el privilegio.
-- ============================================================

revoke execute on function public.detectar_responsable_faltante_area() from authenticated;
revoke execute on function public.cleanup_expired_bloque_locks()       from authenticated;


-- ── Guarda: el estado final se comprueba, no se supone ─────────────────────
--
-- Un `revoke` sobre un privilegio que no existe NO falla, asi que el comando corre igual si
-- el objeto es otro del que se cree. Por cada funcion: el objetivo, y los dos roles que no
-- se pueden romper (`postgres` es el owner y el que pg_cron usa para correr los dos jobs).

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.detectar_responsable_faltante_area()',
    'public.cleanup_expired_bloque_locks()'
  ] loop
    if has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'ABORTA: authenticated conserva EXECUTE sobre %', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'ABORTA: service_role perdio EXECUTE sobre %', v_fn;
    end if;
    if not has_function_privilege('postgres', v_fn, 'execute') then
      raise exception 'ABORTA: postgres perdio EXECUTE sobre %; pg_cron corre los jobs como postgres', v_fn;
    end if;
  end loop;
end $$;
