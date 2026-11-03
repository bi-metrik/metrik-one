-- ============================================================
-- Funciones: la puerta cerrada al iniciar, como opción de cada experiencia (26-oct)
-- ------------------------------------------------------------
-- Decisión de Mauricio (26-oct): llegar 10 minutos antes es fijo en todas las experiencias; la puerta cerrada pasa a
-- ser un campo de la ficha. Paula (26-oct): «Puerta cerrada: aplica solo a las películas, porque la proyección necesita
-- el salón lo más oscuro posible. En los talleres no aplica».
--
-- Qué hace:
--   1. `funcion_experiencias.puerta_cerrada boolean not null default false`. Las fichas que ya existen quedan
--      desmarcadas (en producción no hay ninguna: el módulo está apagado), así una cata no sale con la puerta cerrada.
--   2. `funcion_guardar_experiencia` admite la llave `puerta_cerrada` (booleano; ausente o nula = false) y la guarda.
--      Resto del cuerpo igual al de 20261022170000; mismos grants.
--   3. `funcion_panel_campana` la devuelve dentro de `experiencia` (de ahí sale la bienvenida). Resto igual; mismos grants.
--
-- DDL puro: no toca filas. Dry-run: `node scripts/funciones-puerta-cerrada-dry-run.mjs`.
-- No choca con 20261026210000 (#1298): esa redefine funcion_plazo_saldo y funcion_guardar_campana, no estas dos.
-- ============================================================

alter table public.funcion_experiencias
  add column puerta_cerrada boolean not null default false;

comment on column public.funcion_experiencias.puerta_cerrada is
  'Si la bienvenida al grupo avisa que se cierra la puerta al iniciar (películas). Desmarcada por defecto.';

-- La ficha de la experiencia (P11, §1.8), ahora con `puerta_cerrada`.
create or replace function public.funcion_guardar_experiencia(
  p_workspace_id uuid,
  p_experiencia_id uuid,
  p_ficha jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_extra text;
  v_edad integer;
  v_puerta boolean := false;
  v_items text[];
  v_item jsonb;
  v_texto text;
  v_id uuid;
begin
  if public.funcion_actor(p_workspace_id, true, 'experiencia_no_existe') <> 'equipo' then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;
  if p_ficha is null or jsonb_typeof(p_ficha) <> 'object' then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'ficha';
  end if;
  select k into v_extra from jsonb_object_keys(p_ficha) k
   where k <> all (array['nombre', 'titulo_oferta', 'frase_gancho', 'intro', 'que_incluye', 'emojis_tema',
                         'saludo_grupo', 'relato_grupo', 'edad_minima', 'puerta_cerrada'])
   limit 1;
  if v_extra is not null then
    raise exception 'dato_no_admitido' using errcode = 'P0001', detail = v_extra;
  end if;

  v_nombre := public.funcion_texto_de(p_ficha, 'nombre', 200);
  if v_nombre is null then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'nombre';
  end if;
  if p_ficha ? 'edad_minima' and jsonb_typeof(p_ficha->'edad_minima') <> 'null' then
    if jsonb_typeof(p_ficha->'edad_minima') <> 'number' or (p_ficha->>'edad_minima') !~ '^[0-9]{1,2}$' then
      raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'edad_minima';
    end if;
    v_edad := (p_ficha->>'edad_minima')::integer;
  end if;
  -- La puerta cerrada al iniciar (26-oct): `true` o `false`; ausente o nula = desmarcada (reemplaza la ficha entera).
  if p_ficha ? 'puerta_cerrada' and jsonb_typeof(p_ficha->'puerta_cerrada') <> 'null' then
    if jsonb_typeof(p_ficha->'puerta_cerrada') <> 'boolean' then
      raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'puerta_cerrada';
    end if;
    v_puerta := (p_ficha->'puerta_cerrada')::boolean;
  end if;
  if p_ficha ? 'que_incluye' and jsonb_typeof(p_ficha->'que_incluye') <> 'null' then
    if jsonb_typeof(p_ficha->'que_incluye') <> 'array' then
      raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'que_incluye';
    end if;
    v_items := '{}';
    for v_item in select value from jsonb_array_elements(p_ficha->'que_incluye') loop
      if jsonb_typeof(v_item) <> 'string' then
        raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'que_incluye';
      end if;
      v_texto := nullif(btrim(v_item #>> '{}', E' \t\r\n'), '');
      if v_texto is null then
        continue;
      end if;
      if length(v_texto) > 200 then
        raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'que_incluye: hasta 200 caracteres por línea';
      end if;
      v_items := v_items || v_texto;
    end loop;
    if cardinality(v_items) > 20 then
      raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'que_incluye: hasta 20 líneas';
    end if;
    if cardinality(v_items) = 0 then
      v_items := null;
    end if;
  end if;

  if p_experiencia_id is null then
    insert into public.funcion_experiencias (workspace_id, nombre, titulo_oferta, frase_gancho, intro, que_incluye,
      emojis_tema, saludo_grupo, relato_grupo, edad_minima, puerta_cerrada)
    values (p_workspace_id, v_nombre, public.funcion_texto_de(p_ficha, 'titulo_oferta', 300),
      public.funcion_texto_de(p_ficha, 'frase_gancho', 500), public.funcion_texto_de(p_ficha, 'intro', 3000), v_items,
      public.funcion_texto_de(p_ficha, 'emojis_tema', 40), public.funcion_texto_de(p_ficha, 'saludo_grupo', 4000),
      public.funcion_texto_de(p_ficha, 'relato_grupo', 4000), v_edad, v_puerta)
    returning id into v_id;
  else
    update public.funcion_experiencias
       set nombre = v_nombre,
           titulo_oferta = public.funcion_texto_de(p_ficha, 'titulo_oferta', 300),
           frase_gancho = public.funcion_texto_de(p_ficha, 'frase_gancho', 500),
           intro = public.funcion_texto_de(p_ficha, 'intro', 3000),
           que_incluye = v_items,
           emojis_tema = public.funcion_texto_de(p_ficha, 'emojis_tema', 40),
           saludo_grupo = public.funcion_texto_de(p_ficha, 'saludo_grupo', 4000),
           relato_grupo = public.funcion_texto_de(p_ficha, 'relato_grupo', 4000),
           edad_minima = v_edad,
           puerta_cerrada = v_puerta,
           updated_at = now()
     where id = p_experiencia_id and workspace_id = p_workspace_id
    returning id into v_id;
    if v_id is null then
      raise exception 'experiencia_no_existe' using errcode = 'P0001';
    end if;
  end if;
  return v_id;
end;
$$;

-- ejecutable-por-cliente: el formulario, con la sesión del equipo. SECURITY DEFINER; exige el workspace y rol que edite.
revoke execute on function public.funcion_guardar_experiencia(uuid, uuid, jsonb) from public, anon, service_role;
grant execute on function public.funcion_guardar_experiencia(uuid, uuid, jsonb) to authenticated;

-- Una campaña con su experiencia (ahora con `puerta_cerrada`), su estado efectivo, sus anuncios y su agenda.
create or replace function public.funcion_panel_campana(p_campana_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.funcion_campanas;
  e record;
begin
  select * into c from public.funcion_campanas where id = p_campana_id and archivada_at is null;
  if not found then
    raise exception 'campana_no_existe' using errcode = 'P0001';
  end if;
  perform public.funcion_actor(c.workspace_id, false, 'campana_no_existe');
  select * into e from public.funcion_experiencias where id = c.experiencia_id;
  return jsonb_build_object(
    'campana_id', c.id, 'nombre', c.nombre, 'codigo', c.codigo, 'estado', public.funcion_estado_campana(c),
    'estado_guardado', c.estado, 'publicada', c.agenda_publicada_at is not null, 'desde', c.desde, 'hasta', c.hasta,
    'minutos_apartado', c.minutos_apartado, 'precio_persona', c.precio_persona,
    'precio_preventa_persona', c.precio_preventa_persona, 'abono_persona', c.abono_persona,
    'permite_pago_total', c.permite_pago_total, 'tope_sobreventa', c.tope_sobreventa,
    'dias_saldo_antes', c.dias_saldo_antes,
    'experiencia', jsonb_build_object('experiencia_id', e.id, 'nombre', e.nombre, 'titulo_oferta', e.titulo_oferta,
      'frase_gancho', e.frase_gancho, 'intro', e.intro, 'que_incluye', to_jsonb(e.que_incluye),
      'emojis_tema', e.emojis_tema, 'saludo_grupo', e.saludo_grupo, 'relato_grupo', e.relato_grupo,
      'edad_minima', e.edad_minima, 'puerta_cerrada', e.puerta_cerrada),
    'anuncios', coalesce((select jsonb_agg(a.ad_id order by a.created_at) from public.funcion_campana_anuncios a
                           where a.campana_id = c.id), '[]'::jsonb),
    'funciones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'funcion_id', x.id, 'inicia_at', x.inicia_at, 'inicia_texto', public.funcion_fecha_texto(x.inicia_at),
               'estado', x.estado, 'es_preventa', x.es_preventa, 'preventa_hasta', x.preventa_hasta,
               'cierra_venta_at', x.cierra_venta_at,
               'capacidad', x.capacidad, 'cupo_asistente', x.cupo_asistente, 'ocupadas', x.ocupadas,
               'reservas_activas', x.reservas_activas, 'tarifa', public.funcion_tarifa(x.id)
             ) order by (x.ocupadas >= x.capacidad), x.inicia_at, x.id)
        from (select f.*, public.funcion_ocupadas(f.id) as ocupadas,
                     (select count(*) from public.funcion_reservas r where r.funcion_id = f.id
                        and (r.estado = 'confirmada' or (r.estado = 'apartada' and r.vence_at > now()))) as reservas_activas
                from public.funcion_funciones f where f.campana_id = c.id and f.archivada_at is null) x
    ), '[]'::jsonb)
  );
end;
$$;

-- ejecutable-por-cliente: la pantalla de la campaña, con la sesión del equipo. SECURITY DEFINER; exige el workspace.
revoke execute on function public.funcion_panel_campana(uuid) from public, anon, service_role;
grant execute on function public.funcion_panel_campana(uuid) to authenticated;
