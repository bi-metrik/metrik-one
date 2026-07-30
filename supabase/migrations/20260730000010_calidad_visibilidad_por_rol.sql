-- Visibilidad por rol de calidad: en la base, no solo en la aplicacion.
--
-- QUE ARREGLA
--
-- La segmentacion por rol del modulo existia SOLO en la capa de aplicacion. El
-- codigo lo declaraba por escrito para la lista (`actions.ts`, "LIMITACION
-- HONESTA"), pero el alcance real era mayor: cubria tambien el ranking, el
-- perfil ajeno y el dinero del dueno.
--
-- Tres hechos que se combinaban:
--   1. Las 5 policies de calidad_* filtraban por workspace_id y nada mas.
--   2. Las 8 RPC son `security invoker` con grant execute a `authenticated`,
--      asi que dentro de ellas aplica la RLS del que llama, que solo aisla
--      por workspace.
--   3. `canViewCalidadTodos` y `canViewCalidadDinero` viven en roles.ts, es
--      decir en el server action. Un cliente que no pase por el server action
--      no los encuentra.
--
-- Resultado: cualquier usuario autenticado del workspace, con la anon key que
-- viaja en el bundle y su propio JWT, alcanzaba las RPC por PostgREST.
--
-- MEDIDO el 2026-07-29 simulando la sesion real de un `operator` de advise
-- (Carolina Estupinan, 130 llamadas propias de 565 en el workspace):
--
--   select from calidad_llamadas       -> 565 llamadas, 4 agentes  (debia: 130, 1)
--   get_calidad_lista(ws, null, ...)   -> total 526                (debia: solo suyas)
--   get_calidad_equipo(ws, ...)        -> ranking de los 4 + vendidoUsd por agente
--   get_calidad_perfil_agente('Andres Villamil') -> perfil ajeno completo
--   get_calidad_dinero(ws, 30)         -> vendido 78.302 / recaudado 69.634 / precio 799
--
-- COMO SE CIERRA
--
-- Las policies pasan a mirar el rol y el agente. Las 8 RPC son `invoker`, asi
-- que heredan el recorte sin tocarles el cuerpo: la lista, el perfil y el
-- ranking quedan cerrados sin que esta migracion redefina ninguna funcion de
-- calculo. Eso es deliberado: `calidad_ranking_periodo` y
-- `calidad_bloque_periodo` estan CONGELADAS por la deuda del PR #157 (el
-- ranking se calcula en dos sitios). Aqui no se toca su cuerpo, ni umbrales,
-- ni orden, ni columnas. Solo quien puede leer las filas de abajo.
--
-- EL ROL SE LEE DE `profiles.role`, NO DE `get_user_role()`
--
-- Existe un helper `get_user_role()` que parece servir y NO sirve: lee
-- `staff.rol_plataforma`, que habla otro vocabulario.
--
--   persona    profiles.role (lo que usa la app)   staff.rol_plataforma
--   Carolina   operator                            ejecutor
--   Oscar      owner                               dueno
--   Liliana    supervisor                          supervisor
--
-- Una policy con `get_user_role() = 'operator'` no coincidiria nunca. Y lo
-- peligroso: probada con el SUPERVISOR pasaria, porque es el unico rol donde
-- los dos vocabularios coinciden. Saldria bien por la razon equivocada.
--
-- POR QUE ESTAS TABLAS NO SE REVOCAN A `authenticated`
--
-- La primera idea para el dinero era revocar `select on calidad_recobro_dia
-- from authenticated`. Habria ROTO EL MURO, que es la pantalla que se
-- proyecta: el muro pasa por `calidad_bloque_periodo` -> `calidad_reparto_cuotas`
-- -> `calidad_recobro_dia`, y esa cadena corre como `invoker` con el JWT del
-- supervisor. Verificado contra `pg_proc.prosrc`, no supuesto. Por eso el
-- recobro se cierra por ROL en la policy (el supervisor sigue leyendo, el
-- ejecutor no) y no por grant.
--
-- La unica que si pierde el grant es `get_calidad_dinero`: nadie mas la llama,
-- y su server action (`getDatosDueno`) pasa a consumirla con service_role,
-- que es el patron que el modulo ya usa para `calidad_dinero_cuotas` y para el
-- muro publico.

-- ── 1. Helpers de identidad del caller ──────────────────────────────────────

-- El staff del usuario, con LA MISMA resolucion que getWorkspace():
-- `profile_id = auth.uid() and is_active`. Si divergiera de la de la app, el
-- ejecutor veria cero llamadas — el fallo mas silencioso posible.
create or replace function public.current_user_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from staff
  where profile_id = auth.uid() and is_active = true
  limit 1;
$$;

-- El rol de plataforma segun `profiles.role`. Nombre distinto de
-- `get_user_role()` a proposito: son dos vocabularios y confundirlos es el
-- error descrito arriba.
create or replace function public.current_user_profile_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from profiles where id = auth.uid();
$$;

-- Una llamada es mia? Va en funcion `definer` en vez de un `exists` inline
-- dentro de la policy para no depender de RLS anidada sobre calidad_llamadas.
create or replace function public.calidad_llamada_es_mia(p_llamada_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from calidad_llamadas
    where id = p_llamada_id
      and agente_staff_id = current_user_staff_id()
  );
$$;

revoke execute on function public.current_user_staff_id()          from public, anon;
revoke execute on function public.current_user_profile_role()      from public, anon;
revoke execute on function public.calidad_llamada_es_mia(uuid)     from public, anon;
grant  execute on function public.current_user_staff_id()          to authenticated, service_role;
grant  execute on function public.current_user_profile_role()      to authenticated, service_role;
grant  execute on function public.calidad_llamada_es_mia(uuid)     to authenticated, service_role;

-- ── 2. Quien ve todo el piso ────────────────────────────────────────────────
--
-- La lista es EXPLICITA y fail-closed, no `<> 'operator'`. Con la negacion, un
-- `contador` (canViewCalidad: false en roles.ts) habria seguido leyendo las
-- llamadas por PostgREST, y cualquier rol nuevo entraria por omision. Espeja
-- `canViewCalidadTodos` de src/lib/roles.ts; si esa matriz cambia, esta lista
-- cambia con ella.
create or replace function public.calidad_ve_todo_el_piso()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select current_user_profile_role() in ('owner', 'admin', 'supervisor', 'read_only');
$$;

revoke execute on function public.calidad_ve_todo_el_piso() from public, anon;
grant  execute on function public.calidad_ve_todo_el_piso() to authenticated, service_role;

-- ── 3. Policies ─────────────────────────────────────────────────────────────

-- Llamadas. El ejecutor solo las suyas, resuelto por `agente_staff_id`. Si no
-- tiene staff resuelto, `= null` da null y no ve nada: fail-closed, igual que
-- el guard de aplicacion ("un ejecutor sin staff resuelto no ve nada").
drop policy if exists calidad_llamadas_select on public.calidad_llamadas;
create policy calidad_llamadas_select on public.calidad_llamadas
  for select to authenticated
  using (
    workspace_id = current_user_workspace_id()
    and (
      calidad_ve_todo_el_piso()
      or (
        current_user_profile_role() = 'operator'
        and agente_staff_id = current_user_staff_id()
      )
    )
  );

-- Bloques del eje tecnica. No tienen agente: se resuelven por su llamada.
drop policy if exists calidad_llamadas_bloques_select on public.calidad_llamadas_bloques;
create policy calidad_llamadas_bloques_select on public.calidad_llamadas_bloques
  for select to authenticated
  using (
    workspace_id = current_user_workspace_id()
    and (
      calidad_ve_todo_el_piso()
      or (
        current_user_profile_role() = 'operator'
        and calidad_llamada_es_mia(llamada_id)
      )
    )
  );

-- Hallazgos (banderas de cumplimiento). Mismo criterio: el desglose de una
-- llamada ajena es exactamente lo que la segmentacion existe para no mostrar.
drop policy if exists calidad_llamadas_hallazgos_select on public.calidad_llamadas_hallazgos;
create policy calidad_llamadas_hallazgos_select on public.calidad_llamadas_hallazgos
  for select to authenticated
  using (
    workspace_id = current_user_workspace_id()
    and (
      calidad_ve_todo_el_piso()
      or (
        current_user_profile_role() = 'operator'
        and calidad_llamada_es_mia(llamada_id)
      )
    )
  );

-- Recobro por dia. Es plata del negocio, no dato de agente: no se recorta por
-- agente, se cierra al ejecutor. El supervisor la conserva porque el MURO la
-- necesita por la cadena bloque_periodo -> reparto_cuotas -> recobro_dia.
drop policy if exists calidad_recobro_dia_select on public.calidad_recobro_dia;
create policy calidad_recobro_dia_select on public.calidad_recobro_dia
  for select to authenticated
  using (
    workspace_id = current_user_workspace_id()
    and calidad_ve_todo_el_piso()
  );

-- Cobertura por dia. Agregado del piso, lo consume el muro via
-- calidad_bloque_periodo. Mismo criterio que el recobro.
drop policy if exists calidad_cobertura_dia_select on public.calidad_cobertura_dia;
create policy calidad_cobertura_dia_select on public.calidad_cobertura_dia
  for select to authenticated
  using (
    workspace_id = current_user_workspace_id()
    and calidad_ve_todo_el_piso()
  );

-- ── 4. El dinero, y por que el revoke NO va en esta migracion ───────────────
--
-- Estas policies YA cierran el dinero. `get_calidad_dinero` es `invoker` y se
-- alimenta de `calidad_reparto_cuotas` -> `calidad_llamadas` (recortada arriba)
-- y de `calidad_recobro_dia` (cerrada arriba), asi que a un ejecutor le
-- devuelve SUS numeros, no los del negocio. Medido el 2026-07-30 con estas
-- policias puestas y sin ningun revoke:
--
--   operator (Carolina) -> vendido 7.990    · 10 ventas  · riesgo 0
--   owner    (Oscar)    -> vendido 81.498   · 102 ventas · riesgo 2.476
--
-- Falta el cinturon adicional: quitarle a `authenticated` el execute de
-- `get_calidad_dinero` para que la plata del negocio no dependa solo de que la
-- RLS de dos tablas este bien puesta. Ese revoke vive en la migracion
-- `20260730000011` y NO puede aplicarse antes de desplegar el codigo, porque
-- **la base es compartida entre `main` y esta rama**: el `getDatosDueno()` que
-- hoy corre en produccion todavia llama la RPC con el token del usuario y se
-- rompería en vivo. Orden obligatorio (gotcha "una RPC con consumidores en
-- produccion se AMPLIA, no cambia de forma"): esta migracion -> merge y deploy
-- -> `20260730000011`.
--
-- `calidad_reparto_cuotas` no se revoca nunca: la encadena el muro.

comment on function public.current_user_staff_id() is
  'staff.id del usuario autenticado (profile_id = auth.uid(), activo). Misma resolucion que getWorkspace().';
comment on function public.current_user_profile_role() is
  'profiles.role del usuario autenticado. NO confundir con get_user_role(), que devuelve staff.rol_plataforma (otro vocabulario: ejecutor/dueno).';
comment on function public.calidad_ve_todo_el_piso() is
  'Espejo SQL de canViewCalidadTodos (src/lib/roles.ts). Lista explicita y fail-closed: un rol no listado no ve nada.';
