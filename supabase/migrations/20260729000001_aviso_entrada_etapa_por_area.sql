-- Aviso al entrar a una etapa: permitir dirigirlo a un ÁREA completa
--
-- CASO QUE LO ORIGINA (SOENA, 2026-07-28): cuando un negocio queda listo para
-- facturar (entra a la etapa Facturación), el área financiera tiene que
-- enterarse. Hoy no se entera de nada.
--
-- POR QUE NO ALCANZABA EL MECANISMO ACTUAL, dos razones independientes:
--
--   1. `destinatarios_negocio` resuelve por el STAGE de la etapa y solo conoce
--      dos áreas: venta -> comercial, ejecucion -> operaciones, cobro -> ambas.
--      No existe el caso `financiera`. Facturación es stage `cobro`, así que el
--      aviso le llegaba a comercial y operaciones, nunca a quien factura.
--
--   2. Cuando no hay responsable, esa función escala a `profiles.role =
--      'supervisor'` del área. En SOENA, Diana Parra tiene el CARGO "Supervisor
--      Financiero" pero su ROL es `admin`, así que un escalamiento por rol la
--      dejaría fuera y avisaría solo a Leidy. Es el mismo detalle que la dejó
--      fuera del directorio de aliados.
--
-- COMO SE RESUELVE: reusando `crear_notificacion_equipo` (construida para los
-- pendientes de conciliación), que reparte por `staff_areas.area` SIN filtrar por
-- rol. Diana entra por su área, no por su rol. Además trae la semántica de equipo
-- que se pidió: le llega a todo el área y, cuando una persona lo resuelve,
-- desaparece para las demás (vía `grupo_clave` + `resolver_grupo_notificaciones`).
--
-- OPT-IN, sin efectos colaterales: el comportamiento nuevo solo se activa si la
-- etapa declara `avisar_al_entrar.areas`. Sin ese campo, la función se comporta
-- EXACTAMENTE igual que antes. AFI y cualquier otro workspace no cambian.
--
--   etapas_negocio.config_extra.avisar_al_entrar = {
--     "email": true,
--     "areas": ["financiera"],     -- NUEVO, opcional
--     "titulo": "...",
--     "mensaje": "..."
--   }
--
-- El `grupo_clave` incluye el área a propósito: si un aviso se dirige a dos áreas
-- distintas, que una lo resuelva NO debe borrarlo para la otra (son trabajos
-- distintos sobre el mismo hecho).
--
-- El tipo sigue siendo `negocio_en_etapa`, que YA está en el CHECK de
-- `notificaciones.tipo`. No se agrega ningún tipo nuevo: un tipo ausente del CHECK
-- hace fallar el insert en silencio, y eso ya costó tres incidentes.

create or replace function public.avisar_entrada_etapa()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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
begin
  -- Solo al CAMBIAR de etapa (no en cualquier update del negocio)
  if new.etapa_actual_id is null or new.etapa_actual_id is not distinct from old.etapa_actual_id then
    return new;
  end if;

  select e.config_extra -> 'avisar_al_entrar', e.nombre
    into v_cfg, v_etapa_nombre
  from etapas_negocio e where e.id = new.etapa_actual_id;

  if v_cfg is null then return new; end if;

  v_titulo := coalesce(v_cfg ->> 'titulo',
    coalesce(new.nombre,'Un negocio') || ' llegó a ' || coalesce(v_etapa_nombre,'una etapa nueva'));

  v_mensaje := coalesce(v_cfg ->> 'mensaje', 'Este negocio pasó a tu etapa y espera tu gestión.');
  v_mensaje := replace(v_mensaje, '{negocio}', coalesce(new.nombre, ''));
  v_mensaje := replace(v_mensaje, '{codigo}',  coalesce(new.codigo, ''));
  v_mensaje := replace(v_mensaje, '{etapa}',   coalesce(v_etapa_nombre, ''));

  v_areas := v_cfg -> 'areas';

  if v_areas is not null
     and jsonb_typeof(v_areas) = 'array'
     and jsonb_array_length(v_areas) > 0 then
    -- ── Dirigido a un ÁREA completa (pendiente de equipo) ────────────────────
    -- Reparte por `staff_areas`, sin mirar el rol: así alcanza también a quien
    -- lleva el área con rol `admin` en vez de `supervisor`.
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
    -- ── Comportamiento original: al responsable del stage de la etapa ────────
    -- Se permite repetir: cada entrada a la etapa es un hecho distinto (un
    -- negocio puede volver a Entrega tras un reproceso, y ese aviso es real).
    for v_dest in select * from destinatarios_negocio(new.id) loop
      perform crear_notificacion(
        new.workspace_id, v_dest.profile_id, 'negocio_en_etapa',
        v_titulo, 'negocio', new.id, '/negocios/' || new.id::text,
        jsonb_build_object('etapa', v_etapa_nombre, 'mensaje', v_mensaje, 'via', v_dest.via),
        true
      );
    end loop;
  end if;

  -- ── Correo (opt-in por etapa) ─────────────────────────────────────────────
  -- La edge function resuelve destinatarios y correos (incluido el caso `areas`);
  -- acá solo se dispara. Si el secreto no está configurado, el aviso in-app ya
  -- quedó hecho.
  if coalesce((v_cfg ->> 'email')::boolean, false) then
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
$$;

comment on function public.avisar_entrada_etapa() is
  'Avisa (in-app + correo opcional) cuando un negocio entra a una etapa con config_extra.avisar_al_entrar. Por defecto resuelve el destinatario por el stage de la etapa (responsable del caso). Si la etapa declara `areas`, reparte a esas áreas completas como pendiente de equipo vía crear_notificacion_equipo (alcanza por staff_areas, sin filtrar por rol). Trigger para cubrir todos los caminos de cambio de etapa sin acoplarse al motor.';
