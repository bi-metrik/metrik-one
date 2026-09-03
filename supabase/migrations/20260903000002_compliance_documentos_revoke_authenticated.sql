-- Compliance — cerrar el execute que quedo abierto en la funcion de trigger
--
-- Medido en produccion despues de aplicar 20260903000001: la funcion
-- `tg_compliance_documentos_touch` sigue con EXECUTE para `authenticated`. El
-- revoke original solo quito `public` y `anon`, copiando el precedente de
-- 20260831000003 (periodicidad), que tiene el mismo hueco: en este proyecto
-- `authenticated` tiene grant explicito sobre las funciones de public, y
-- revocar PUBLIC no lo alcanza.
--
-- El riesgo concreto es bajo: llamada fuera de un trigger, la funcion falla de
-- inmediato porque no hay NEW. Se cierra igual, porque la marca de intencion en
-- una migracion de compliance tiene que corresponder con lo que la base hace, y
-- un permiso que sobra hoy es el que nadie revisa cuando la funcion cambie.
--
-- server-only: no crea tablas; mantiene la superficie de las funciones del
-- expediente reducida al service client, que es quien valida el rol del oficial.

revoke execute on function public.tg_compliance_documentos_touch() from authenticated;

revoke execute on function public.compliance_registrar_version_documento(
  uuid, uuid, text, text, date, text, date, text, text, text, text, uuid
) from authenticated;
