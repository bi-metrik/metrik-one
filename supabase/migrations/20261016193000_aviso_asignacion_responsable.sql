-- Aviso a la persona que queda como responsable de un negocio (Trappvel, 2026-10-16).
--
-- POR QUÉ. Mauricio, en la reunión con Trappvel: al crear un viaje el bot pregunta siempre quién lo
-- lleva, y esa persona tiene que enterarse en la campanita de ONE y por correo. El aviso sale desde
-- CUALQUIER camino de asignación: el bot de WhatsApp, la asignación a mano (`agregarResponsable`),
-- la automática por etapa (`responsable-automatico.ts`) y los scripts. Por eso es un trigger sobre
-- `negocio_responsables` y no código en cada camino (la misma lección de `asignarResponsable`: de
-- cinco caminos, solo uno anotaba en el timeline).
--
-- QUÉ HACE. AFTER INSERT en `negocio_responsables` (una fila NUEVA: una reasignación de la misma
-- persona es un UPDATE por el upsert y no avisa). Si el workspace lo encendió:
--   · crea la notificación `asignacion_responsable` (tipo que ya existe en el CHECK) para el perfil
--     de esa persona, con el enlace al negocio;
--   · llama a la edge function `avisar-asignacion` por pg_net (mismo secreto y misma URL del vault
--     que `avisar_entrada_etapa`), que manda el correo con la plantilla de los avisos de etapa.
-- No avisa: a quien se asignó a sí misma (`assigned_by` = su perfil), a un staff inactivo o sin
-- perfil, por un negocio que no está abierto, ni dos veces a la misma persona por el mismo negocio
-- en 10 minutos (quitar y volver a poner).
--
-- ENCENDIDO POR WORKSPACE (opt-in): `workspaces.config_extra.avisar_asignacion = true`. Sin la
-- clave, nada cambia: los cargues masivos de SOENA insertan cientos de responsables y no pueden
-- convertirse en cientos de correos sin que alguien lo decida. El SQL que lo enciende en Trappvel
-- va aparte (no en esta migración).
--
-- ORDEN. Desplegar la edge function `avisar-asignacion` ANTES de aplicar esto (y antes de encender
-- la clave). Si la función no existe, pg_net recibe un 404 y no pasa nada más: la campanita sale
-- igual, el correo no.
--
-- NUNCA TUMBA LA ASIGNACIÓN. Todo el cuerpo va en un bloque con `exception when others`: un fallo
-- del aviso queda como WARNING en el log de Postgres y la fila del responsable se escribe igual.

create or replace function public.avisar_asignacion_responsable()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ws uuid;
  v_codigo text;
  v_nombre text;
  v_estado text;
  v_cfg jsonb;
  v_profile uuid;
  v_activo boolean;
  v_por text;
  v_titulo text;
  v_mensaje text;
  v_secret text;
  v_url text;
begin
  begin
    select n.workspace_id, n.codigo, n.nombre, n.estado, w.config_extra
      into v_ws, v_codigo, v_nombre, v_estado, v_cfg
    from negocios n join workspaces w on w.id = n.workspace_id
    where n.id = new.negocio_id;

    if v_ws is null then return new; end if;
    if coalesce((v_cfg ->> 'avisar_asignacion')::boolean, false) is not true then return new; end if;
    if coalesce(v_estado, 'abierto') <> 'abierto' then return new; end if;

    select s.profile_id, s.is_active into v_profile, v_activo
    from staff s where s.id = new.staff_id and s.workspace_id = v_ws;
    if v_profile is null or v_activo is not true then return new; end if;

    -- Se asignó a sí misma: ya lo sabe.
    if new.assigned_by is not null and new.assigned_by = v_profile then return new; end if;

    -- Quitar y volver a poner en minutos no es otro aviso.
    if exists (
      select 1 from notificaciones x
      where x.destinatario_id = v_profile
        and x.tipo = 'asignacion_responsable'
        and x.entidad_id = new.negocio_id
        and x.created_at > now() - interval '10 minutes'
    ) then
      return new;
    end if;

    if new.assigned_by is not null then
      select s.full_name into v_por from staff s
      where s.profile_id = new.assigned_by and s.workspace_id = v_ws;
    end if;

    -- El mismo texto que el correo (`_shared/aviso-asignacion.ts`): si cambia uno, cambia el otro.
    v_nombre := coalesce(nullif(btrim(v_nombre), ''), 'un negocio');
    v_titulo := 'Te asignaron ' || case when v_codigo is not null then v_codigo || ' · ' || v_nombre else v_nombre end;
    v_mensaje := case
      when v_por is not null then v_por || ' te dejó como responsable'
      else 'Quedaste como responsable'
    end || case when new.rol is not null then ' (' || new.rol || ')' else '' end || ' de este negocio.';

    perform crear_notificacion(
      v_ws, v_profile, 'asignacion_responsable', v_titulo,
      'negocio', new.negocio_id, '/negocios/' || new.negocio_id::text,
      jsonb_build_object('mensaje', v_mensaje, 'rol', new.rol, 'asignado_por', v_por, 'staff_id', new.staff_id),
      true
    );

    select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'NOTIFICAR_ETAPA_SECRET' limit 1;
    select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'SUPABASE_FUNCTIONS_URL' limit 1;
    if v_secret is not null and v_url is not null then
      perform net.http_post(
        url := v_url || '/avisar-asignacion',
        body := jsonb_build_object('negocio_id', new.negocio_id, 'staff_id', new.staff_id, 'asignado_por', new.assigned_by),
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret)
      );
    end if;
  exception when others then
    raise warning 'avisar_asignacion_responsable (negocio %, staff %): %', new.negocio_id, new.staff_id, sqlerrm;
  end;
  return new;
end;
$function$;

-- Función de trigger: la invoca el motor en el INSERT, nunca un cliente. `security definer`, así
-- que una llamada suelta correría con los permisos del dueño.
revoke execute on function public.avisar_asignacion_responsable() from public, anon;

drop trigger if exists trg_avisar_asignacion_responsable on public.negocio_responsables;
create trigger trg_avisar_asignacion_responsable
  after insert on public.negocio_responsables
  for each row execute function public.avisar_asignacion_responsable();
