-- ============================================================
-- 20261029190000 — Una modificación por aviso se puede REGISTRAR antes y PUBLICARSE a una hora fija
--
-- Para qué (2026-10-29): la v1.5 de los Términos VALIDA · Plan CDA se publica el domingo 1-nov-2026.
-- Sin esto, la guarda `documentos_versiones_por_aviso()` (20261007150000) exige `publicada_at <= now()`:
-- registrar la fila ES publicar, así que el SQL de publicación tendría que correrse el domingo.
-- Con esto, la sesión principal registra la v1.5 el viernes 30-oct (con el OK de Mauricio) con
-- `publicada_at = 2026-11-01 00:00 Bogotá`, y la plataforma la muestra desde ese instante.
--
-- QUÉ CAMBIA: una sola condición de la guarda. `publicada_at` puede estar en el futuro hasta 7 días
-- (antes: nunca). Todo lo demás de la función queda igual, mensajes incluidos.
--
-- CÓMO: se reemplaza SOLO esa condición sobre la definición VIVA (`pg_get_functiondef`), con la técnica
-- de 20261016100100, que ya parchó esta función por texto (sumó `suscripcion_id`): reescribirla entera
-- desde 20261007150000 borraría ese parche. Si el patrón no aparece exactamente una vez, aborta sin tocar
-- nada. Idempotente: con la marca `publicacion_programada` ya en la función, no hace nada.
-- `create or replace` (lo que devuelve pg_get_functiondef) conserva dueño, search_path y la ACL.
--
-- POR QUÉ NO SE PIERDE LA PRUEBA DEL PREAVISO:
--   · la app no muestra una versión por aviso antes de su `publicada_at` (ni el aviso, ni la pantalla,
--     ni el documento, ni el PDF): `sinAvisosFuturos` en `src/lib/valida-api/terminos.ts`, aplicado a
--     la ÚNICA lectura de documentos del cliente (`documentosDelCliente`) y a la descarga del PDF;
--   · la base no deja aceptarla antes: `aceptaciones_terminos_modulo()` ya exige
--     `publicada_at <= now()` (20261007150000, paso 1), no se toca;
--   · `publicada_at` sigue inmutable (`documentos_versiones_inmutables`), y la vigencia sigue exigiendo
--     30 días desde el día (Bogotá) de `publicada_at`, no desde el registro;
--   · la constancia de que cada persona lo VIO sigue siendo `avisos_modificacion_vistos`, que solo se
--     escribe al pintarlo.
--   · el tope de 7 días impide dejar una publicación «programada» olvidada.
--
-- QUÉ ESCRIBE: DDL (reemplaza una función de trigger). Ni una fila de datos. El código de producción
-- de hoy (sin el PR) no depende de esto, y el del PR tampoco: sin esta migración, el SQL de la v1.5
-- solo corre el mismo día de la publicación (lo dice su cabecera).
--
-- Verificación después de aplicar (solo lectura):
--   select position('publicacion_programada' in prosrc) > 0 from pg_proc
--    where proname = 'documentos_versiones_por_aviso';                        -> true
--   select proacl from pg_proc where proname = 'documentos_versiones_por_aviso'; -> sin anon/authenticated/PUBLIC
--
-- Cómo revertir: el mismo reemplazo al revés (la condición `if new.publicada_at > now() then raise
-- exception '… el aviso no se publica en el futuro …'`), mientras no haya una fila con publicada_at futura.
-- ============================================================

do $parche$
declare
  v_def   text;
  v_viejo constant text := E'  if new.publicada_at > now() then\n    raise exception ''documentos_contractuales_versiones: el aviso no se publica en el futuro (%): se registra al publicarlo'', new.publicada_at;\n  end if;';
  v_nuevo constant text := E'  -- publicacion_programada (20261029190000): el aviso se puede registrar hasta 7 días antes de su\n  -- publicación; la app no lo muestra antes de `publicada_at` y la base no deja aceptarlo antes.\n  if new.publicada_at > now() + interval ''7 days'' then\n    raise exception ''documentos_contractuales_versiones: el aviso se programa a lo sumo 7 días antes de publicarse (%)'', new.publicada_at;\n  end if;';
  v_veces int;
begin
  select pg_get_functiondef('public.documentos_versiones_por_aviso()'::regprocedure) into v_def;
  if position('publicacion_programada' in v_def) > 0 then
    raise notice 'documentos_versiones_por_aviso ya admite la publicación programada: nada que hacer';
    return;
  end if;
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  if v_veces <> 1 then
    raise exception 'documentos_versiones_por_aviso: se esperaba la guarda de publicación exactamente 1 vez y aparece %. Abortado sin tocar nada.', v_veces;
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end;
$parche$;

revoke execute on function public.documentos_versiones_por_aviso() from public, anon, authenticated;
