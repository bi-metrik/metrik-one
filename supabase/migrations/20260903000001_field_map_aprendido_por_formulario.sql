-- El mapa de un formulario de Meta se aprende una vez y se guarda.
--
-- Contexto: `config_extra.meta_leads.field_map` dice qué campo del formulario es
-- el nombre, cuál el teléfono y cuál el correo. Está escrito a mano por
-- workspace, con los nombres exactos. En agosto de 2026 un formulario nuevo
-- empezó a mandar `nombre_completo` y `correo_electrónico` donde el mapa esperaba
-- `full_name` y `email`: entraron 97 leads con el contacto vacío durante dos
-- semanas y nadie se enteró, porque el webhook respondía 200 y el dato quedaba
-- enterrado en el payload.
--
-- La red por parecido (PR #497) tapa el caso conocido. Un formulario que pregunte
-- "¿A qué número te escribimos?" vuelve a caer. Lo que sigue es que el webhook
-- ENTIENDA el formulario que no conoce, y para eso guarda aquí lo que entendió.
--
-- ⚠️ Por qué esta función y no un update desde el webhook:
--
--   Cuando llega un formulario nuevo, no llega un lead: llegan varios a la vez.
--   Cada uno leería `config_extra`, le añadiría su mapa y lo escribiría entero de
--   vuelta. El último en escribir borra lo que escribieron los otros, y lo hace
--   sobre la MISMA columna donde vive el `page_id` del workspace: un lead perdido
--   sería el menor de los daños. `jsonb_set` en una sola sentencia es atómico y
--   no puede pisar hermanos.

create or replace function guardar_field_map_formulario(
  p_workspace_id uuid,
  p_form_id      text,
  p_mapa         jsonb
)
returns void
language sql
volatile
security invoker
set search_path = public
as $$
  update workspaces
  set config_extra = jsonb_set(
        -- `true` al final crea el camino si no existe: el primer formulario
        -- aprendido de un workspace no tiene todavía el objeto contenedor.
        coalesce(config_extra, '{}'::jsonb),
        array['meta_leads', 'field_map_por_formulario', p_form_id],
        p_mapa,
        true
      )
  where id = p_workspace_id
    -- Solo se escribe sobre un workspace que YA tiene meta_leads configurado.
    -- Sin esta guarda, un form_id mal enrutado crearía la rama `meta_leads` en un
    -- workspace que no usa Meta, y ese objeto a medias es peor que no tener nada:
    -- el webhook lo leería como configuración válida sin `page_id`.
    and config_extra ? 'meta_leads';
$$;

comment on function guardar_field_map_formulario is
  'Guarda, de forma atomica, el mapa de campos aprendido para un form_id de Meta en workspaces.config_extra.meta_leads.field_map_por_formulario. Atomico a proposito: varios leads del mismo formulario nuevo llegan a la vez y un read-modify-write desde el webhook se pisaria a si mismo.';

revoke all on function guardar_field_map_formulario(uuid, text, jsonb) from public, anon;
grant execute on function guardar_field_map_formulario(uuid, text, jsonb) to service_role;
