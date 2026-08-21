-- Envolver `auth.uid()` en un subselect dentro de las politicas RLS.
--
-- `auth.uid()` se inlinea a un `coalesce(nullif(current_setting(...)))`. Escrito
-- suelto, el planner lo trata como filtro y lo evalua FILA POR FILA; envuelto en
-- `(select auth.uid())` se vuelve un InitPlan: se evalua una vez y ademas queda
-- disponible como condicion de indice.
--
-- Medido contra produccion el 2026-08-21 sobre `notificaciones` (3.811 filas),
-- con la sesion del usuario que mas tiene:
--
--   hoy       Index Scan por created_at + Filter · 3.811 filas descartadas
--             2.088 buffers · Execution Time 195,7 ms
--   envuelto  Bitmap Index Scan por idx_notificaciones_destinatario
--             5 buffers · Execution Time 2,4 ms
--
-- Ochenta veces. Y no es una pantalla suelta: el layout resuelve las
-- notificaciones en CADA render, asi que esos ~193 ms estaban en toda
-- navegacion de la app, para todos los workspaces.
--
-- La semantica no cambia: `auth.uid()` es STABLE, asi que evaluarla una vez por
-- consulta o una vez por fila da el mismo resultado. Lo unico que cambia es
-- cuantas veces se evalua.
--
-- `alter policy` y no drop+create, a proposito: no existe un instante en el que
-- la tabla quede sin politica.
--
-- Los predicados de abajo NO estan escritos a mano. Se generaron desde
-- `pg_policies` de produccion — o sea, son literalmente la politica vigente
-- deparseada por Postgres — con `auth.uid()` reemplazada por
-- `(select auth.uid())` y nada mas. Se hizo asi para que no exista la
-- posibilidad de un error de transcripcion: esto decide quien ve que.
--
-- ── Lo que este archivo NO toca, y por que ───────────────────────────────────
-- Hay 217 politicas en 118 tablas que llaman `current_user_workspace_id()`
-- suelta, y el advisor las marca igual. Pero medido en `negocios`, esa funcion
-- SI entra como condicion de indice
-- (`Index Cond: (workspace_id = current_user_workspace_id())`, 0,26 ms): al no
-- inlinearse, el planner la trata como la funcion STABLE que es y la resuelve
-- una vez. Reescribir 217 politicas de produccion sin una mejora medida detras
-- es riesgo sin retorno.
--
-- ── Un hallazgo que se deja como esta ────────────────────────────────────────
-- Las dos politicas de `etapa_sla_log` traen `p.workspace_id = p.workspace_id`
-- desde su migracion original: una columna comparada consigo misma, siempre
-- cierta. Se preserva tal cual y se reporta aparte. Corregirla cambia quien
-- puede leer y escribir, y eso no se mete de contrabando en un cambio de
-- rendimiento. No abre un hueco: el `workspace_id = current_user_workspace_id()`
-- de afuera ya acota la fila al workspace del usuario.

-- ── notificaciones: la unica con volumen, y la que se paga en cada render ────
alter policy notificaciones_select on notificaciones
  using ((destinatario_id = (select auth.uid())));

alter policy notificaciones_update on notificaciones
  using ((destinatario_id = (select auth.uid())));

-- ── El resto: tablas de 0 a 43 filas. Sin ganancia medible; van para que la ──
-- ── convencion quede pareja y el advisor deje de marcarlas.                 ──
alter policy profiles_insert on profiles
  with check ((id = (select auth.uid())));

alter policy profiles_update on profiles
  using ((id = (select auth.uid())));

alter policy ws_insert on workspaces
  with check (((select auth.uid()) IS NOT NULL));

alter policy team_invitations_select on team_invitations
  using ((workspace_id IN ( SELECT profiles.workspace_id
   FROM profiles
  WHERE (profiles.id = (select auth.uid())))));

alter policy team_invitations_insert on team_invitations
  with check ((workspace_id IN ( SELECT profiles.workspace_id
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

alter policy team_invitations_update on team_invitations
  using ((workspace_id IN ( SELECT profiles.workspace_id
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

alter policy tutorial_progress_select on tutorial_progress
  using (((workspace_id = current_user_workspace_id()) AND (user_id = (select auth.uid()))));

alter policy tutorial_progress_insert on tutorial_progress
  with check (((workspace_id = current_user_workspace_id()) AND (user_id = (select auth.uid()))));

alter policy tutorial_progress_update on tutorial_progress
  using (((workspace_id = current_user_workspace_id()) AND (user_id = (select auth.uid()))));

alter policy tutorial_progress_delete on tutorial_progress
  using (((workspace_id = current_user_workspace_id()) AND (user_id = (select auth.uid()))));

alter policy etapa_sla_log_select_owner_admin_supervisor on etapa_sla_log
  using (((workspace_id = current_user_workspace_id()) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.workspace_id = p.workspace_id) AND (p.role = ANY (ARRAY['owner'::text, 'admin'::text, 'supervisor'::text])))))));

alter policy etapa_sla_log_insert_owner_admin on etapa_sla_log
  with check (((workspace_id = current_user_workspace_id()) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.workspace_id = p.workspace_id) AND (p.role = ANY (ARRAY['owner'::text, 'admin'::text, 'supervisor'::text])))))));
