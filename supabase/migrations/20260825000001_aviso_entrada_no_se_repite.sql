-- Un aviso de entrada NO se repite cuando el trabajo que anuncia ya se hizo.
--
-- Lo obliga la devolucion que mueve el caso (`devolucion-actions.ts`). Cuando operaciones
-- devuelve un certificado bancario vencido, el caso vuelve a Anexos, y `avisar_entrada_etapa`
-- cuelga del UPDATE de `negocios.etapa_actual_id`: dispara otra vez los dos avisos de esa
-- etapa. En SOENA VE eso son un correo interno ("Cita DIAN: avisale la fecha al cliente") y
-- un WhatsApp AL CLIENTE ("tu cita con la DIAN quedo agendada"). Los dos dirian algo falso:
-- la cita ya se aviso, y el cliente ya lo sabe. Un WhatsApp no se desmanda.
--
-- No hace falta un contador nuevo: el bloque gate que cierra ese trabajo ya registra que se
-- hizo. Si esta completo, el aviso se omite. La condicion la declara la ETAPA en su
-- `config_extra`, nunca el codigo: sin la clave el comportamiento es identico al de hoy, asi
-- que esto por si solo no cambia nada en ninguna linea (opt-in).
--
-- Se omiten los DOS avisos, el interno y el del cliente, porque los dos anuncian el mismo
-- trabajo. Quien tiene que enterarse de que el caso volvio ya recibe su propio aviso, con el
-- motivo: `devolucion_bloque`, que manda la action y no este trigger.
--
-- Generaliza la regla que dejo `20260818000003`: ningun aviso de "esto espera tu gestion" se
-- manda por una entrada que no es real.
--
-- Cambia el arranque (declaracion de dos variables y un guard de 12 lineas). El resto del
-- cuerpo es identico al vigente (volcado de `pg_get_functiondef`, no transcrito a mano).

create or replace function public.avisar_entrada_etapa()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cfg jsonb;
  v_etapa_nombre text;
  v_titulo text;
  v_mensaje text;
  v_dest record;
  v_url text;
  v_secret text;
  v_areas jsonb;
  v_area text;
  v_grupo text;
  v_cfg_cliente jsonb;
  v_interno boolean;
  v_cliente boolean;
  v_omitir_slug text;
  v_ya_hecho boolean;
begin
  if new.etapa_actual_id is null or new.etapa_actual_id is not distinct from old.etapa_actual_id then
    return new;
  end if;

  -- Un negocio que llega CERRADO no espera la gestion de nadie. Pasa cuando la etapa de
  -- cierre se resuelve en el mismo movimiento que la llegada (cierre automatico).
  if coalesce(new.estado, 'abierto') <> 'abierto' then
    return new;
  end if;

  select e.config_extra -> 'avisar_al_entrar', e.config_extra -> 'avisar_al_cliente', e.nombre
    into v_cfg, v_cfg_cliente, v_etapa_nombre
  from etapas_negocio e where e.id = new.etapa_actual_id;

  if coalesce((v_cfg ->> 'activo')::boolean, true) = false then v_cfg := null; end if;
  v_interno := v_cfg is not null;
  v_cliente := coalesce((v_cfg_cliente ->> 'email')::boolean, false) or coalesce((v_cfg_cliente ->> 'whatsapp')::boolean, false);
  if not v_interno and not v_cliente then return new; end if;
  -- Apagado explicito: la config se conserva, el aviso no sale.
  if coalesce((v_cfg ->> 'activo')::boolean, true) = false then return new; end if;

  -- Reentrada: el aviso anuncia trabajo NUEVO. Si el bloque que declara ese trabajo ya esta
  -- completo, el equipo ya lo hizo y el cliente ya se entero; repetirlo dice algo falso.
  -- Se lee de cualquiera de las dos configs para no obligar a declararlo dos veces.
  v_omitir_slug := coalesce(v_cfg ->> 'omitir_si_bloque_completo', v_cfg_cliente ->> 'omitir_si_bloque_completo');
  if v_omitir_slug is not null then
    select exists (
      select 1
      from negocio_bloques nb
      join bloque_configs bc on bc.id = nb.bloque_config_id
      where nb.negocio_id = new.id
        and bc.slug = v_omitir_slug
        and nb.estado = 'completo'
    ) into v_ya_hecho;
    if v_ya_hecho then return new; end if;
  end if;

  v_titulo := coalesce(v_cfg ->> 'titulo',
    coalesce(new.nombre,'Un negocio') || ' llegó a ' || coalesce(v_etapa_nombre,'una etapa nueva'));

  v_mensaje := coalesce(v_cfg ->> 'mensaje', 'Este negocio pasó a tu etapa y espera tu gestión.');
  v_mensaje := replace(v_mensaje, '{negocio}', coalesce(new.nombre, ''));
  v_mensaje := replace(v_mensaje, '{codigo}',  coalesce(new.codigo, ''));
  v_mensaje := replace(v_mensaje, '{etapa}',   coalesce(v_etapa_nombre, ''));

  v_areas := case when v_interno then v_cfg -> 'areas' else null end;

  if v_areas is not null
     and jsonb_typeof(v_areas) = 'array'
     and jsonb_array_length(v_areas) > 0 then
    for v_area in select jsonb_array_elements_text(v_areas) loop
      v_grupo := 'etapa:' || new.etapa_actual_id::text
              || ':negocio:' || new.id::text
              || ':area:' || v_area;
      perform crear_notificacion_equipo(
        new.workspace_id, v_area, 'negocio_en_etapa', v_titulo, v_grupo,
        'negocio', new.id, '/negocios/' || new.id::text,
        jsonb_build_object('etapa', v_etapa_nombre, 'mensaje', v_mensaje, 'via', 'area_' || v_area)
      );
    end loop;
  else
    for v_dest in select * from destinatarios_negocio(new.id) where v_interno loop
      perform crear_notificacion(
        new.workspace_id, v_dest.profile_id, 'negocio_en_etapa',
        v_titulo, 'negocio', new.id, '/negocios/' || new.id::text,
        jsonb_build_object('etapa', v_etapa_nombre, 'mensaje', v_mensaje, 'via', v_dest.via),
        true
      );
    end loop;
  end if;

  if coalesce((v_cfg ->> 'email')::boolean, false) or v_cliente then
    select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'NOTIFICAR_ETAPA_SECRET' limit 1;

    if v_secret is not null then
      select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'SUPABASE_FUNCTIONS_URL' limit 1;

      if v_url is not null then
        perform net.http_post(
          url := v_url || '/notificar-etapa',
          body := jsonb_build_object('negocio_id', new.id),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_secret
          )
        );
      end if;
    end if;
  end if;

  return new;
end;
$function$;

-- Activacion en SOENA VE: Anexos es la UNICA de las tres etapas destino de devolucion que
-- declara avisos de entrada (Validacion y Documentacion no tienen ninguno), asi que el
-- problema del aviso repetido es exclusivo del certificado bancario. El bloque que cierra
-- el trabajo es el gate `notificacion_cita_cliente`, que vive en esa misma etapa.
update etapas_negocio e
set config_extra = jsonb_set(
  jsonb_set(
    e.config_extra,
    '{avisar_al_entrar,omitir_si_bloque_completo}', '"notificacion_cita_cliente"'::jsonb, true
  ),
  '{avisar_al_cliente,omitir_si_bloque_completo}', '"notificacion_cita_cliente"'::jsonb, true
)
where e.linea_id = '34a0fa6b-9ed3-4652-a419-42601132d1a8'
  and e.nombre = 'Anexos'
  and e.config_extra ? 'avisar_al_entrar'
  and e.config_extra ? 'avisar_al_cliente';
