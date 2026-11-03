-- Quién asignó a un responsable cuando no fue una persona (Trappvel, 2026-10-26).
--
-- POR QUÉ. Los viajes que abre el bot de WhatsApp y los que toma la regla por etapa
-- (`responsable-automatico.ts`) quedaban con `assigned_by` nulo, y la campanita decía «Quedaste como
-- responsable (comercial) de este negocio.» sin decir quién ni por qué. Con `assigned_by` solo se
-- sabe de personas; esta columna dice el ORIGEN de la asignación:
--   · 'persona'      — alguien la hizo (en ONE o eligiendo en el bot); `assigned_by` = su perfil.
--   · 'bot_whatsapp' — el bot asignó sin una persona identificada que escribiera.
--   · 'regla_etapa'  — la regla `etapas_negocio.config_extra.responsable_automatico` al entrar a una
--                      etapa; `asignado_etapa_id` = esa etapa (para decir cuál, en el aviso y en el detalle).
-- Las filas viejas quedan en NULL: sin backfill (no se sabe con certeza cuál fue su origen).
--
-- QUÉ CAMBIA. Solo DDL: dos columnas nullable, su check y la función del trigger
-- `avisar_asignacion_responsable` (20261016193000) con el texto por origen:
--   · persona:      «Edgar Alba te dejó como responsable (comercial) de este negocio.» (como hoy)
--   · bot:          «El bot de WhatsApp te dejó como responsable (comercial) de este negocio.»
--   · regla_etapa:  «Quedaste como responsable (comercial) de este negocio al entrar a la etapa Cotización.»
--   · sin rol se omite el paréntesis; sin origen ni persona, el texto de siempre.
-- El correo (`_shared/aviso-asignacion.ts`, edge `avisar-asignacion`) arma el MISMO texto.
--
-- ORDEN. Aplicar ANTES del merge: la app y el bot escriben `asignado_origen` en el upsert, y sin la
-- columna PostgREST rechaza la fila (el responsable no quedaría). La edge `avisar-asignacion` lee las
-- columnas aparte y tolera que no existan.

alter table public.negocio_responsables
  add column if not exists asignado_origen text,
  add column if not exists asignado_etapa_id uuid references public.etapas_negocio(id) on delete set null;

alter table public.negocio_responsables
  drop constraint if exists negocio_responsables_asignado_origen_check;
alter table public.negocio_responsables
  add constraint negocio_responsables_asignado_origen_check
  check (asignado_origen is null or asignado_origen in ('persona', 'bot_whatsapp', 'regla_etapa'));

comment on column public.negocio_responsables.asignado_origen is
  'Origen de la asignación: persona | bot_whatsapp | regla_etapa. NULL = fila anterior al 2026-10-26.';
comment on column public.negocio_responsables.asignado_etapa_id is
  'Con asignado_origen = regla_etapa: la etapa a la que entró el negocio cuando la regla lo asignó.';

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
  v_etapa text;
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
    if new.asignado_etapa_id is not null then
      select e.nombre into v_etapa from etapas_negocio e where e.id = new.asignado_etapa_id;
    end if;

    -- El mismo texto que el correo (`_shared/aviso-asignacion.ts`): si cambia uno, cambia el otro.
    -- Con persona (assigned_by que se resuelve a un nombre del workspace) manda la persona; sin ella, el origen.
    v_nombre := coalesce(nullif(btrim(v_nombre), ''), 'un negocio');
    v_titulo := 'Te asignaron ' || case when v_codigo is not null then v_codigo || ' · ' || v_nombre else v_nombre end;
    v_mensaje := case
      when v_por is not null then v_por || ' te dejó como responsable'
      when new.asignado_origen = 'bot_whatsapp' then 'El bot de WhatsApp te dejó como responsable'
      else 'Quedaste como responsable'
    end || case when new.rol is not null then ' (' || new.rol || ')' else '' end || ' de este negocio'
      || case
        when v_por is null and new.asignado_origen = 'regla_etapa' and nullif(btrim(v_etapa), '') is not null
          then ' al entrar a la etapa ' || btrim(v_etapa)
        else ''
      end || '.';

    perform crear_notificacion(
      v_ws, v_profile, 'asignacion_responsable', v_titulo,
      'negocio', new.negocio_id, '/negocios/' || new.negocio_id::text,
      jsonb_build_object('mensaje', v_mensaje, 'rol', new.rol, 'asignado_por', v_por, 'staff_id', new.staff_id,
        'asignado_origen', new.asignado_origen, 'etapa', v_etapa),
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

-- Función de trigger: la invoca el motor en el INSERT, nunca un cliente.
revoke execute on function public.avisar_asignacion_responsable() from public, anon;
