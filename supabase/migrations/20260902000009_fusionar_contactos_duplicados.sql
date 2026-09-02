-- Fusionar dos contactos que son la misma persona.
--
-- El guardián de duplicados (20260902000007) impide crear el duplicado 101. No
-- limpia los 100 que ya estaban: para eso hace falta poder juntarlos, y ONE no
-- tenía cómo. Sin esto la única salida era borrar un contacto a mano, que se
-- lleva por delante sus interacciones (FK en CASCADE) y deja los negocios
-- huérfanos (FK en SET NULL). Es decir: perder el historial que justamente
-- queremos consolidar.
--
-- Qué hace: repunta TODA referencia del perdedor al ganador, completa los datos
-- que al ganador le falten, guarda lo que no cabe (un correo distinto, otro
-- teléfono) en `custom_data.fusiones` para que nada se evapore, y recién
-- entonces borra el perdedor.
--
-- Las diez tablas que apuntan a `contactos.id` están enumeradas a mano y no por
-- catálogo, a propósito: si mañana nace una tabla nueva con `contacto_id`, esta
-- función debe fallar en revisión de código y no repuntar en silencio algo que
-- nadie miró. El `raise` de abajo verifica esa lista contra el catálogo.

create or replace function fusionar_contactos(
  p_workspace_id uuid,
  p_ganador uuid,
  p_perdedor uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_ganador   contactos%rowtype;
  v_perdedor  contactos%rowtype;
  v_tablas_fk int;
  v_resumen   jsonb;
begin
  if p_ganador = p_perdedor then
    raise exception 'Ganador y perdedor son el mismo contacto (%)', p_ganador;
  end if;

  -- El workspace se exige en el WHERE, no se deduce del contacto: así una
  -- fusión nunca puede cruzar dos clientes por un id mal copiado.
  select * into v_ganador  from contactos where id = p_ganador  and workspace_id = p_workspace_id;
  if not found then
    raise exception 'Contacto ganador % no existe en el workspace %', p_ganador, p_workspace_id;
  end if;
  select * into v_perdedor from contactos where id = p_perdedor and workspace_id = p_workspace_id;
  if not found then
    raise exception 'Contacto perdedor % no existe en el workspace %', p_perdedor, p_workspace_id;
  end if;

  -- Guardia contra la tabla nueva que nadie enumeró. Cuenta cuántas columnas de
  -- `public` referencian `contactos.id`; si aparece una más que las 10 conocidas,
  -- la fusión se detiene en vez de dejar filas apuntando a un contacto borrado.
  select count(*) into v_tablas_fk
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid = 'public.contactos'::regclass
    and c.connamespace = 'public'::regnamespace;
  if v_tablas_fk <> 10 then
    raise exception
      'Hay % referencias a contactos.id y esta función solo repunta 10. Actualizar fusionar_contactos antes de usarla.',
      v_tablas_fk;
  end if;

  -- Historial y actividad
  update contacto_interacciones set contacto_id = p_ganador where contacto_id = p_perdedor;
  update meta_leads_eventos     set contacto_id = p_ganador where contacto_id = p_perdedor;
  update funnelchat_eventos     set contacto_id = p_ganador where contacto_id = p_perdedor;
  update cs_chat_sessions       set contacto_id = p_ganador where contacto_id = p_perdedor;
  update cs_escalamientos       set contacto_id = p_ganador where contacto_id = p_perdedor;
  -- Negocio y estructura
  update negocios      set contacto_id = p_ganador where contacto_id = p_perdedor;
  update oportunidades set contacto_id = p_ganador where contacto_id = p_perdedor;
  update proyectos     set contacto_id = p_ganador where contacto_id = p_perdedor;
  update empresas      set contacto_id = p_ganador where contacto_id = p_perdedor;
  -- Autorreferencia: el perdedor podía ser el promotor de alguien más.
  update contactos set fuente_promotor_id = p_ganador where fuente_promotor_id = p_perdedor;

  -- El ganador se queda con lo que tenga; lo que le falte lo hereda del perdedor.
  -- Nunca al revés: un dato presente no se pisa con otro, porque no hay forma de
  -- saber cuál de los dos es el bueno y sobrescribir sí destruye.
  update contactos set
    telefono = coalesce(v_ganador.telefono, v_perdedor.telefono),
    email    = coalesce(v_ganador.email,    v_perdedor.email),
    -- Entre dos nombres reales gana el del ganador. El marcador del webhook no
    -- es un nombre: si el ganador lo trae, cede ante cualquier nombre de verdad.
    nombre   = case
                 when upper(trim(v_ganador.nombre)) = 'LEAD SIN NOMBRE'
                  and upper(trim(coalesce(v_perdedor.nombre,''))) <> 'LEAD SIN NOMBRE'
                 then v_perdedor.nombre
                 else v_ganador.nombre
               end,
    fuente_adquisicion = coalesce(v_ganador.fuente_adquisicion, v_perdedor.fuente_adquisicion),
    fuente_detalle     = coalesce(v_ganador.fuente_detalle,     v_perdedor.fuente_detalle),
    segmento           = coalesce(v_ganador.segmento,           v_perdedor.segmento),
    -- El origen de primer toque del más antiguo de los dos es el verdadero.
    custom_data = coalesce(v_ganador.custom_data, '{}'::jsonb)
      || case
           when coalesce(v_ganador.custom_data->'origen', 'null'::jsonb) = 'null'::jsonb
                and v_perdedor.custom_data ? 'origen'
           then jsonb_build_object('origen', v_perdedor.custom_data->'origen')
           else '{}'::jsonb
         end
      -- Rastro de la fusión. Lo que el ganador ya tenía y no pudo heredarse (un
      -- correo distinto, otro teléfono) queda aquí y no se pierde.
      || jsonb_build_object('fusiones',
           coalesce(v_ganador.custom_data->'fusiones', '[]'::jsonb) ||
           jsonb_build_array(jsonb_build_object(
             'contacto_id', p_perdedor,
             'nombre',      v_perdedor.nombre,
             'telefono',    v_perdedor.telefono,
             'email',       v_perdedor.email,
             'creado_en',   v_perdedor.created_at,
             'fusionado_en', now()
           ))),
    updated_at = now()
  where id = p_ganador;

  delete from contactos where id = p_perdedor and workspace_id = p_workspace_id;
  if not found then
    -- RLS o una FK sin repuntar. Sin esto la fusión "terminaría" dejando los dos
    -- contactos vivos y los datos ya movidos al ganador.
    raise exception 'No se pudo borrar el contacto perdedor %', p_perdedor;
  end if;

  select jsonb_build_object(
    'ganador', p_ganador,
    'perdedor', p_perdedor,
    'nombre', c.nombre,
    'telefono', c.telefono,
    'email', c.email,
    'interacciones', (select count(*) from contacto_interacciones i where i.contacto_id = p_ganador),
    'negocios',      (select count(*) from negocios n where n.contacto_id = p_ganador)
  ) into v_resumen
  from contactos c where c.id = p_ganador;

  return v_resumen;
end;
$$;

comment on function fusionar_contactos(uuid, uuid, uuid) is
  'Junta dos contactos duplicados: repunta las 10 referencias del perdedor al ganador, completa los datos vacíos del ganador y borra el perdedor. Lo que no cabe queda en custom_data.fusiones.';

revoke all on function fusionar_contactos(uuid, uuid, uuid) from public;
grant execute on function fusionar_contactos(uuid, uuid, uuid) to authenticated;
