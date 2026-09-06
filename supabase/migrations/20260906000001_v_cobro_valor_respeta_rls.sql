-- v_cobro_valor vuelve a respetar el RLS de quien la consulta.
--
-- Que paso. El 2026-08-11 la migracion 20260811120000_pagos_por_tramo.sql la dejo
-- con `security_invoker = on`. El 2026-09-02, 20260902220053_tableros_honorario_neto_de_iva.sql
-- la reemplazo con `CREATE OR REPLACE VIEW` para agregarle `a_tramo1_base` y
-- `a_tramo2_base`, y no volvio a declarar la opcion.
--
-- CREATE OR REPLACE VIEW **sin clausula WITH** RESETEA las `reloptions`. Los grants
-- sobreviven; la opcion no. La vista quedo corriendo como su dueno (`postgres`), o sea
-- sin aplicar el RLS de `cobros`, y con `select` concedido a `authenticated`.
--
-- Consecuencia medida el 2026-09-06, con el control en la MISMA sentencia para que no
-- se pueda confundir con un rol que no cambio:
--
--   begin; set local role authenticated;
--     TABLA cobros ......... 0 filas   <- el RLS funciona
--     TABLA negocios ....... 0 filas   <- el RLS funciona
--     VISTA v_cobro_valor .. 429 filas de 4 workspaces, $308.931.827
--   rollback;
--
-- Y con las claims de un admin REAL de SOENA, que es como se ve en la aplicacion:
--   antes:   429 filas, 4 workspaces
--   despues: 390 filas, 1 workspace
--   SOENA tiene exactamente 390 filas (contadas sin RLS): no se pierde ninguna.
--
-- Las vistas que leen esta no cambian para SOENA (ensayo con rollback):
--   v_pyl_mes 10 -> 10 · v_cartera_negocio 309 -> 309 · v_negocio_valor 427 -> 427
--   v_mc_linea_mes 27 -> 11, y 11 es exactamente lo que SOENA tiene: las 16 que se
--   van son de otros workspaces.
--
-- NO se revoca el `select` a `authenticated`, y esa decision es deliberada:
-- `v_pyl_mes` y `v_mc_linea_mes` tienen `security_invoker=on`, leen esta vista y se
-- consultan con el cliente de sesion desde `numeros/actions-v2.ts`. Con invoker, el
-- permiso sobre el objeto de abajo se comprueba contra QUIEN CONSULTA: revocarlo las
-- dejaria devolviendo 42501, que un `?? []` convierte en un cero silencioso. La
-- proteccion la da el RLS, que es lo que esta migracion repone.
--
-- No crea tablas ni funciones, y no toca un solo dato.

alter view public.v_cobro_valor set (security_invoker = on);

-- Guarda: si la opcion no quedo puesta, la migracion falla ruidosamente en vez de
-- reportar exito sobre una vista que sigue abierta.
do $$
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'v_cobro_valor'
      and c.reloptions::text like '%security_invoker=on%'
  ) then
    raise exception 'v_cobro_valor quedo SIN security_invoker: la migracion no aplico';
  end if;
end $$;

comment on view public.v_cobro_valor is
  'Imputacion de cada cobro por tramo (honorario, tarifa, excedente). security_invoker=on: '
  'respeta el RLS de quien consulta. Si alguna migracion la reemplaza con CREATE OR REPLACE '
  'VIEW, tiene que volver a declarar la opcion o la vista queda leyendo todos los workspaces.';
