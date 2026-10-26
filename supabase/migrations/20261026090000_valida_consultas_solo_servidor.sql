-- El historial de Valida (`valida_consultas`) lo escribe SOLO el servidor (2026-10-26).
--
-- Hallazgo de la auditoria de escala de Valida (2026-10-25), confirmado en produccion en solo lectura:
-- `authenticated` tenia INSERT, SELECT, UPDATE y DELETE sobre la tabla, y las politicas de
-- 20260506100001 (reescritas en 20260831000005) dejaban a una sesion INSERTAR y ACTUALIZAR filas de
-- su propio espacio. Con la llave anon publica y su propio token, un usuario podia cambiar la
-- severidad de una consulta suya o fabricar una "sin hallazgo" en el historial de ONE. No es fuga
-- entre espacios (la politica ata todo a `current_user_workspace_id()`), pero el historial es lo que
-- el CDA muestra como soporte de sus consultas.
--
-- Nada de ONE escribe esta tabla con la sesion: la consulta puntual, el cargue masivo, el score y el
-- reporte usan `createServiceClient()` (service_role, sin RLS). La sesion solo LEE lo de su espacio,
-- y eso no cambia: queda la politica `valida_consultas_select` y el SELECT a `authenticated`.
--
-- No borra ni cambia ninguna fila ni columna: quita dos politicas y unos permisos.
-- epoca: no-rompe ningun codigo de ONE escribe valida_consultas con la sesion; las pestanas viejas tampoco
--
-- Reversa: volver a crear las dos politicas tal como quedaron en 20260831000005 y
--   grant insert, update, delete on public.valida_consultas to authenticated;

drop policy if exists valida_consultas_insert on public.valida_consultas;
drop policy if exists valida_consultas_update on public.valida_consultas;

revoke insert, update, delete, truncate, references, trigger on public.valida_consultas from anon, authenticated;
revoke all on public.valida_consultas from anon;
