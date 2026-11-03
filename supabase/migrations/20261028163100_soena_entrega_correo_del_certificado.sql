-- ============================================================
-- SOE-031 (SOENA) — «Correo de entrega al cliente» pasa a ser «Envío del certificado al cliente»
--
-- Workspace SOENA 7dea141d-d4da-483d-a78d-b14ef35500c5, etapa «Entrega».
--
-- ANTES: el bloque 39474c2e-f1b9-4f10-a3af-c7490787490e era de tipo `datos` (destinatario,
-- nombre, identificación y una `plantilla` para copiar). No mandaba nada y el equipo no lo usa:
-- el correo con el enlace al certificado UPME ya lo manda `notificar-etapa` al entrar a la etapa
-- (`avisar_al_cliente` de la etapa, `link_bloque_slug = concepto_upme`).
--
-- DESPUÉS: el MISMO bloque (misma fila de `bloque_configs`, mismo id, mismo orden) pasa a ser de
-- tipo `avisos_cliente`: muestra a qué correo se mandó el certificado, cuándo, y si llegó o
-- rebotó. Con `confirmar` apuntando al gate «Confirmación de entrega»
-- (298a7669-d332-424f-8ba0-0fa3d5f0896e), el acuse de entrega marca `certificado_entregado` y
-- `fecha_entrega`, con una nota en `notas`. El gate sigue siendo gate y se puede marcar a mano.
--
-- ¿POR QUÉ CAMBIAR EL TIPO DE LA FILA Y NO BORRARLA Y CREAR OTRA?
--   · Borrar la fila de `bloque_configs` arrastra en cascada sus `negocio_bloques`: se perdería
--     la data que el equipo ya escribió en negocios viejos.
--   · `bloque_configs` no tiene columna de «inactivo»: «desactivarla» no existe.
--   · Cambiando el tipo, las filas de `negocio_bloques` de los negocios que ya pasaron o están en
--     Entrega quedan INTACTAS (su data vieja se conserva, solo deja de pintarse), y el
--     `config_extra` anterior queda guardado entero en `config_extra._config_anterior`.
--   · No hay gate en juego: el bloque viejo no era gate y el nuevo tampoco.
--
-- QUÉ LE PASA A LOS NEGOCIOS QUE HOY ESTÁN EN ENTREGA: nada se escribe sobre ellos. Al abrirlos,
-- el bloque muestra los correos de Entrega que ya existen en `avisos_cliente`. La marca
-- automática solo corre con acuses que lleguen DESPUÉS de aplicar la migración (y de avisos de
-- los últimos 7 días): un caso cuyo correo ya fue entregado antes no se marca solo, se marca a
-- mano como hasta hoy.
--
-- ⚠️ Requiere 20261028163000 aplicada antes (el tipo `avisos_cliente`). Aborta si no.
-- Idempotente: si el bloque ya es `avisos_cliente`, no hace nada.
-- ============================================================

do $$
declare
  c_ws     constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  c_bloque constant uuid := '39474c2e-f1b9-4f10-a3af-c7490787490e';
  c_gate   constant uuid := '298a7669-d332-424f-8ba0-0fa3d5f0896e';
  v_def_avisos uuid;
  v_viejo  record;
  v_gate   record;
  v_slugs  text[];
  v_aviso  jsonb;
begin
  select id into v_def_avisos from public.bloque_definitions where tipo = 'avisos_cliente';
  if v_def_avisos is null then
    raise exception 'SOE-031: falta el tipo avisos_cliente (aplicar antes 20261028163000)';
  end if;

  select bc.id, bc.etapa_id, bc.slug, bc.config_extra, bd.tipo
    into v_viejo
    from public.bloque_configs bc
    join public.bloque_definitions bd on bd.id = bc.bloque_definition_id
   where bc.id = c_bloque and bc.workspace_id = c_ws;
  if not found then
    raise exception 'SOE-031: no existe el bloque % en SOENA', c_bloque;
  end if;
  if v_viejo.tipo = 'avisos_cliente' then
    raise notice 'SOE-031: el bloque ya es avisos_cliente; nada que hacer';
    return;
  end if;
  if v_viejo.tipo <> 'datos' then
    raise exception 'SOE-031: el bloque % es de tipo %, se esperaba datos', c_bloque, v_viejo.tipo;
  end if;

  -- Nadie más puede estar leyendo el bloque viejo por slug (auto_fill, doc_link, copias): si lo
  -- hace, cambiarle el tipo lo dejaría sin datos. Se frena en vez de romperlo en silencio.
  if v_viejo.slug is not null and exists (
    select 1 from public.bloque_configs o
     where o.workspace_id = c_ws and o.id <> c_bloque
       and o.config_extra::text like '%"' || v_viejo.slug || '"%'
  ) then
    raise exception 'SOE-031: otro bloque de SOENA referencia el slug % del bloque viejo', v_viejo.slug;
  end if;

  -- El gate: misma etapa, gate, y con los tres campos que la marca escribe.
  select bc.id, bc.etapa_id, bc.es_gate, bc.config_extra, bd.tipo
    into v_gate
    from public.bloque_configs bc
    join public.bloque_definitions bd on bd.id = bc.bloque_definition_id
   where bc.id = c_gate and bc.workspace_id = c_ws;
  if not found then
    raise exception 'SOE-031: no existe el gate % en SOENA', c_gate;
  end if;
  if v_gate.tipo <> 'datos' or v_gate.es_gate is not true or v_gate.etapa_id <> v_viejo.etapa_id then
    raise exception 'SOE-031: el gate % no es un bloque datos gate de la misma etapa (tipo %, gate %)',
      c_gate, v_gate.tipo, v_gate.es_gate;
  end if;
  select array_agg(f ->> 'slug') into v_slugs
    from jsonb_array_elements(coalesce(v_gate.config_extra -> 'fields', '[]'::jsonb)) f;
  if not (coalesce(v_slugs, array[]::text[]) @> array['certificado_entregado', 'fecha_entrega', 'notas']) then
    raise exception 'SOE-031: el gate no tiene los campos esperados; tiene %', v_slugs;
  end if;
  if v_gate.config_extra ? 'compartido_con_origen' then
    raise exception 'SOE-031: el gate es un bloque compartido; la marca escribiría en la copia';
  end if;

  -- La etapa tiene que estar mandando el correo; si no, el bloque quedaría vacío para siempre.
  select e.config_extra -> 'avisar_al_cliente' into v_aviso
    from public.etapas_negocio e where e.id = v_viejo.etapa_id;
  if v_aviso is null or coalesce((v_aviso ->> 'email')::boolean, false) is not true then
    raise warning 'SOE-031: la etapa no declara avisar_al_cliente.email=true (%); el bloque no verá correos', v_aviso;
  end if;

  update public.bloque_configs
     set bloque_definition_id = v_def_avisos,
         nombre = 'Envío del certificado al cliente',
         es_gate = false,
         estado = 'visible',
         config_extra = jsonb_build_object(
           'canal', 'email',
           'que_se_envio', 'el certificado UPME',
           'confirmar', jsonb_build_object(
             'bloque_config_id', c_gate,
             'campo', 'certificado_entregado',
             'campo_fecha', 'fecha_entrega',
             'campo_notas', 'notas'
           ),
           'avisar_rebote', true,
           '_config_anterior', v_viejo.config_extra
         )
   where id = c_bloque;
end $$;
