-- El dinero de calidad sale del alcance del token del usuario.
--
-- ⚠️ ESTA MIGRACION SE APLICA DESPUES DE DESPLEGAR EL CODIGO, NUNCA ANTES.
--
-- La base es compartida entre `main` y cualquier rama. El `getDatosDueno()` que
-- corre en produccion hasta el deploy de esta rama llama `get_calidad_dinero`
-- con el cliente del usuario (su JWT); si se le quita el grant a
-- `authenticated` antes, la pestaña de Calidad del dueño se rompe en vivo, con
-- los datos intactos y sin error en logs. Es el gotcha "una RPC con
-- consumidores en produccion se AMPLIA, no cambia de forma" aplicado a un
-- grant en vez de a una forma de retorno.
--
-- Orden:
--   1. `20260730000010` (policies)  ← ya aplicada, no rompe nada
--   2. merge + deploy del PR #160   ← `getDatosDueno()` pasa a service_role
--   3. esta migracion
--
-- El codigo desplegado en el paso 2 funciona con el grant puesto Y sin el
-- (service_role no depende de este grant), asi que el paso 3 no tiene ventana
-- de riesgo. Al reves si la tendria.
--
-- POR QUE, si las policies ya cerraron el dinero. Porque hoy la plata del
-- negocio depende de que la RLS de DOS tablas siga bien puesta
-- (`calidad_llamadas` y `calidad_recobro_dia`). Con el revoke, la RPC deja de
-- ser alcanzable con el token del usuario y el unico camino es el server action
-- que valida `canViewCalidadDinero`. Defensa en profundidad, no redundancia:
-- son dos capas que fallan por motivos distintos.
--
-- OJO al mantener: `get_calidad_dinero` es la unica RPC del modulo que nadie
-- mas encadena (verificado en `pg_proc.prosrc`). Si alguna funcion futura la
-- llamara como `invoker`, este revoke la rompe. Esa es la razon de que las
-- otras RPC del modulo conserven su grant.

revoke execute on function public.get_calidad_dinero(uuid, integer) from authenticated;

comment on function public.get_calidad_dinero(uuid, integer) is
  'Vista de dinero del dueno. Solo service_role: se consume desde getDatosDueno(), que valida canViewCalidadDinero. NO devolver el grant a authenticated.';
