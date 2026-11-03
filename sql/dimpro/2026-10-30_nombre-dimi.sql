-- Nombre del asistente de VENTAS de Dimpro (30-oct): «Hola, soy Dimi, asistente virtual de Dimpro». Pone al día en bot_parametros las fichas perfil, rf.bienvenida
-- y publica una versión nueva del reglamento SOLO si alguna cambió (idempotente).
--
-- GENERADO desde supabase/functions/_shared/agente/publico/ventas/reglamento-dimpro.ts (semilla-sql-dimpro.ts --nombre).
-- No se edita a mano. NO es una migración: escribe DATOS del workspace dimpro. La corre la sesión principal con
-- service_role, en cualquier momento: no depende de un deploy (el saludo ya usa {nombre}).

do $$
declare
  v_ws uuid := '67f7af44-b5ac-4d5c-aa9e-44954368447c';
  v_bot text := 'asistente-publico';
  v_cambios integer := 0;
  v_n integer;
begin
  if not exists (select 1 from public.workspaces where id = v_ws and slug = 'dimpro') then
    raise exception 'este reglamento es solo del workspace dimpro';
  end if;

  create temporary table _fichas_dimpro (workspace_id uuid, bot text, clave text, tipo text, carga text, cuando text, hacer text, herramientas text[], prioridad integer, fuente text, valores jsonb) on commit drop;
  insert into _fichas_dimpro (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
  values
    (v_ws, 'asistente-publico', 'perfil', 'perfil', 'siempre', null, 'Asistente virtual de Dimpro: responde por los productos publicados (herramienta y equipo), su precio y sus especificaciones, explica despacho, recogida y pago, toma los datos del pedido y envía el link de pago.', null, null, 'brief ventas Dimpro (29-oct); Mauricio 30-oct: «soy Dimi, asistente virtual de Dimpro»', '{"nombre":"Dimi","negocio":"Dimpro","canales":"Messenger","audiencia":"clientes que escriben por el Messenger de la página de Dimpro","idioma":"español de Colombia, de tú"}'::jsonb),
    (v_ws, 'asistente-publico', 'rf.bienvenida', 'respuesta_fija', 'siempre', null, 'Hola, soy {nombre}, asistente virtual de Dimpro. Si sigues la conversación, aceptas nuestros términos y la política de datos: {link}. Si prefieres hablar con alguien del equipo, escríbeme "persona".', null, null, 'Diseño §5.1 adaptado (borrador; falta el visto de Emilio; link HUECO)', '{"version":"2026-10-29.ensayo-1"}'::jsonb);

  update public.bot_parametros p
     set tipo = f.tipo, carga = f.carga, cuando = f.cuando, hacer = f.hacer, herramientas = f.herramientas,
         prioridad = f.prioridad, fuente = f.fuente, valores = f.valores, activo = true, updated_at = now()
    from _fichas_dimpro f
   where p.workspace_id = v_ws and p.bot = v_bot and p.clave = f.clave
     and (p.tipo, p.carga, p.cuando, p.hacer, p.herramientas, p.prioridad, p.fuente, p.valores, p.activo)
         is distinct from (f.tipo, f.carga, f.cuando, f.hacer, f.herramientas, f.prioridad, f.fuente, f.valores, true);
  get diagnostics v_n = row_count;
  v_cambios := v_cambios + v_n;

  insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
  select f.workspace_id, f.bot, f.clave, f.tipo, f.carga, f.cuando, f.hacer, f.herramientas, f.prioridad, f.fuente, f.valores
    from _fichas_dimpro f
   where not exists (select 1 from public.bot_parametros p where p.workspace_id = v_ws and p.bot = v_bot and p.clave = f.clave);
  get diagnostics v_n = row_count;
  v_cambios := v_cambios + v_n;

  if v_cambios > 0 then
    perform public.bot_publicar_reglamento(v_ws, v_bot, 'asistente de ventas Dimpro: se llama Dimi (30-oct)');
    raise notice 'fichas cambiadas: %; reglamento publicado', v_cambios;
  else
    raise notice 'sin cambios: no se publica';
  end if;
end;
$$;
