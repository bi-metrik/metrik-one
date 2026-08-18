-- Un aviso de entrada NO se manda a un negocio que llega cerrado.
--
-- `avisar_entrada_etapa` cuelga del UPDATE de `negocios.etapa_actual_id` y hasta hoy no
-- miraba `estado`. El aviso dice, literalmente, "este negocio paso a tu etapa y espera tu
-- gestion" (en Facturacion de SOENA: "emite la factura en SIIGO"), asi que mandarlo sobre un
-- negocio ya cerrado pide un trabajo que no existe. Y no es solo ruido en la campana: esa
-- configuracion lleva `email: true`, o sea que sale un CORREO al area, y un correo no se
-- desmanda.
--
-- Se vuelve alcanzable con el cierre automatico al llegar a la etapa de cierre: ahi la etapa
-- y el cierre viajan en el mismo UPDATE, y sin este guard el trigger veria la llegada y
-- avisaria igual. Pero la regla es general y vale por si sola: ningun aviso de "esto espera
-- tu gestion" tiene sentido sobre un negocio que ya termino.
--
-- Lo unico que cambia es el arranque: 4 lineas al inicio. El resto del cuerpo es identico al
-- vigente (volcado de `pg_get_functiondef`, no transcrito a mano).

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

-- Es funcion de TRIGGER: nadie la invoca por RPC y PostgREST ni siquiera expone funciones
-- que retornan `trigger`. `create or replace` conserva la ACL, pero se repite el revoke para
-- que la migracion sea autocontenida y no dependa del estado previo.
revoke execute on function public.avisar_entrada_etapa() from public, anon, authenticated;
