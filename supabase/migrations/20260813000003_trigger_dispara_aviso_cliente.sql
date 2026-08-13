-- El trigger de entrada a etapa también despacha el aviso al CLIENTE.
--
-- `avisar_entrada_etapa()` salía temprano cuando la etapa no declaraba
-- `avisar_al_entrar`, así que una etapa configurada SOLO para avisarle al cliente no
-- disparaba nada: el interruptor de `/flujo` quedaría encendido sin efecto, que es
-- justo la pantalla que miente.
--
-- Cambios, todos sobre la definición VIGENTE volcada de la base y con cada reemplazo
-- contado (la función cuelga del UPDATE de `negocios.etapa_actual_id`: transcribirla
-- de memoria rompería el avance de etapa en producción):
--
--   1. Lee también `avisar_al_cliente`.
--   2. Sale solo si NINGUNO de los dos avisos aplica.
--   3. La notificación in-app del equipo queda condicionada al aviso interno, que
--      antes era la única razón para seguir.
--   4. Llama a la edge function si el aviso interno pide correo O si el del cliente
--      lo pide. La edge function decide a quién le escribe.
--   5. Cierra las DOS ramas de la notificación in-app, no solo la de áreas: con el
--      aviso interno apagado, la rama por defecto le seguía avisando al equipo.

do $$
declare
  v_def text;
  v_reemplazos int := 0;

  -- 1) Leer las dos configuraciones
  v_select_viejo constant text :=
    'select e.config_extra -> ''avisar_al_entrar'', e.nombre
    into v_cfg, v_etapa_nombre
  from etapas_negocio e where e.id = new.etapa_actual_id;';
  v_select_nuevo constant text :=
    'select e.config_extra -> ''avisar_al_entrar'', e.config_extra -> ''avisar_al_cliente'', e.nombre
    into v_cfg, v_cfg_cliente, v_etapa_nombre
  from etapas_negocio e where e.id = new.etapa_actual_id;';

  -- 2) Salir solo si ninguno aplica
  v_guard_viejo constant text := 'if v_cfg is null then return new; end if;';
  v_guard_nuevo constant text :=
    'if coalesce((v_cfg ->> ''activo'')::boolean, true) = false then v_cfg := null; end if;
  v_interno := v_cfg is not null;
  v_cliente := coalesce((v_cfg_cliente ->> ''email'')::boolean, false);
  if not v_interno and not v_cliente then return new; end if;';

  -- 4) Disparar la edge function por cualquiera de los dos motivos
  v_http_viejo constant text := 'if coalesce((v_cfg ->> ''email'')::boolean, false) then';
  v_http_nuevo constant text := 'if coalesce((v_cfg ->> ''email'')::boolean, false) or v_cliente then';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'avisar_entrada_etapa';

  if v_def is null then raise exception 'avisar_entrada_etapa no existe'; end if;
  if position('v_cfg_cliente' in v_def) > 0 then
    raise notice 'ya despacha el aviso al cliente; sin cambios';
    return;
  end if;

  -- Declarar las variables nuevas
  if position('  v_grupo text;' in v_def) = 0 then
    raise exception 'no se encontro la zona de declaraciones esperada';
  end if;
  v_def := replace(v_def, '  v_grupo text;',
    '  v_grupo text;' || E'\n' ||
    '  v_cfg_cliente jsonb;' || E'\n' ||
    '  v_interno boolean;' || E'\n' ||
    '  v_cliente boolean;');

  if position(v_select_viejo in v_def) = 0 then raise exception 'select de config no encontrado'; end if;
  v_def := replace(v_def, v_select_viejo, v_select_nuevo);
  v_reemplazos := v_reemplazos + 1;

  if position(v_guard_viejo in v_def) = 0 then raise exception 'guard de salida no encontrado'; end if;
  v_def := replace(v_def, v_guard_viejo, v_guard_nuevo);
  v_reemplazos := v_reemplazos + 1;

  -- La notificacion in-app solo cuando hay aviso interno. Son DOS ramas y hay que
  -- cerrar las dos: con `v_areas` en null la primera no entra, pero la segunda
  -- (destinatarios por stage) le seguiria avisando al equipo con el aviso apagado.
  if position('  v_areas := v_cfg -> ''areas'';' in v_def) = 0 then
    raise exception 'bloque de notificacion in-app no encontrado';
  end if;
  v_def := replace(v_def, '  v_areas := v_cfg -> ''areas'';',
    '  v_areas := case when v_interno then v_cfg -> ''areas'' else null end;');
  v_reemplazos := v_reemplazos + 1;

  if position('for v_dest in select * from destinatarios_negocio(new.id) loop' in v_def) = 0 then
    raise exception 'loop de destinatarios no encontrado';
  end if;
  v_def := replace(v_def,
    'for v_dest in select * from destinatarios_negocio(new.id) loop',
    'for v_dest in select * from destinatarios_negocio(new.id) where v_interno loop');
  v_reemplazos := v_reemplazos + 1;

  if position(v_http_viejo in v_def) = 0 then raise exception 'condicion del http_post no encontrada'; end if;
  v_def := replace(v_def, v_http_viejo, v_http_nuevo);
  v_reemplazos := v_reemplazos + 1;

  if v_reemplazos <> 5 then
    raise exception 'se esperaban 5 reemplazos y se aplicaron %', v_reemplazos;
  end if;

  execute v_def;
end $$;
