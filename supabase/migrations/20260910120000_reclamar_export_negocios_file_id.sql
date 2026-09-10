-- Reclamo atomico del archivo de Drive donde se publica la tabla de negocios.
--
-- Contexto. La subida a Drive de `/negocios` mantiene UN solo documento por workspace y
-- le reemplaza el contenido en cada clic (mismo id, mismo enlace). El id vive en
-- `workspaces.config_extra.drive_export_negocios.file_id`.
--
-- ⚠️ Por que hace falta SQL y no basta con leer-y-escribir desde la aplicacion. Dos
-- razones, y las dos ya costaron caro en este repo:
--
--   1. CARRERA. Dos personas oprimen el boton casi a la vez y ninguna de las dos ve un
--      `file_id` guardado: las dos crean su archivo y el workspace queda con dos hojas
--      vivas, cada una con la mitad de la gente mirandola. `reclamar_...` cierra eso
--      porque el `update ... where <la clave sigue vacia>` es atomico: gana exactamente
--      uno, y el que pierde recibe el id del ganador y manda el suyo a la papelera.
--
--   2. PISAR HERMANOS. `config_extra` es una sola columna compartida: ahi viven tambien
--      `meta_leads.field_map_por_formulario` (que el webhook escribe en rafaga cuando
--      arranca un formulario nuevo), `siigo_*`, `negocio_card` y la config de avisos. Un
--      leer-modificar-escribir desde la server action borraria en silencio lo que otro
--      proceso acabe de escribir en OTRA rama del jsonb. `jsonb_set` en una sola
--      sentencia no puede: toca su rama y deja el resto intacto. Mismo motivo por el que
--      existe `guardar_field_map_formulario` (20260903000001).
--
-- Esta migracion es de ESQUEMA: crea dos funciones y no lee ni escribe una sola fila de
-- datos. No hay backfill.

-- ── Reclamar ────────────────────────────────────────────────────────────────
--
-- Devuelve el id que quedo guardado, que puede NO ser el que se paso:
--   - si la clave estaba vacia  -> gana quien llama y devuelve `p_file_id`
--   - si ya habia uno           -> devuelve el que ya estaba (quien llama perdio)
-- Asi quien llama compara el retorno contra lo que mando y sabe si gano, sin
-- necesidad de una segunda consulta que volveria a abrir la carrera.

create or replace function reclamar_export_negocios_file_id(
  p_workspace_id uuid,
  p_file_id      text
)
returns text
language plpgsql
volatile
security invoker
set search_path = public
as $function$
declare
  v_ganador text;
begin
  if p_file_id is null or btrim(p_file_id) = '' then
    raise exception 'p_file_id no puede venir vacio';
  end if;

  update workspaces
  set config_extra = jsonb_set(
        -- `true` al final crea el camino: un workspace que nunca exporto no tiene
        -- todavia el objeto contenedor.
        coalesce(config_extra, '{}'::jsonb),
        array['drive_export_negocios', 'file_id'],
        to_jsonb(btrim(p_file_id)),
        true
      )
  where id = p_workspace_id
    -- La guarda de la carrera. `nullif` trata la cadena vacia como ausente: una clave
    -- que quedo en "" por una edicion a mano no puede bloquear el reclamo para siempre.
    and nullif(config_extra #>> '{drive_export_negocios,file_id}', '') is null
  returning config_extra #>> '{drive_export_negocios,file_id}' into v_ganador;

  if v_ganador is not null then
    return v_ganador;
  end if;

  -- No se actualizo ninguna fila: o ya habia un id (perdimos la carrera) o el
  -- workspace no existe. La segunda consulta distingue los dos casos devolviendo null.
  select nullif(config_extra #>> '{drive_export_negocios,file_id}', '')
    into v_ganador
  from workspaces
  where id = p_workspace_id;

  return v_ganador;
end;
$function$;

comment on function reclamar_export_negocios_file_id is
  'Reclama de forma atomica el file_id de la hoja de Drive donde se publica la tabla de negocios. Devuelve el id que QUEDO guardado, que puede ser el de otro si dos clics simultaneos compitieron.';

revoke execute on function reclamar_export_negocios_file_id(uuid, text) from public, anon;
grant execute on function reclamar_export_negocios_file_id(uuid, text) to service_role;

-- ── Soltar ──────────────────────────────────────────────────────────────────
--
-- Para cuando el archivo guardado ya no sirve (lo borraron o esta en la papelera).
--
-- ⚠️ Compara-y-suelta: solo borra la clave si TODAVIA vale `p_file_id`. Soltar a ciegas
-- tirarian el id sano que otra persona pudo reclamar entre que se leyo la ficha rota y
-- se decidio soltarla, y el resultado seria un archivo nuevo por clic — exactamente el
-- defecto que este par de funciones existe para evitar.

create or replace function soltar_export_negocios_file_id(
  p_workspace_id uuid,
  p_file_id      text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public
as $function$
declare
  v_filas int;
begin
  update workspaces
  set config_extra = jsonb_set(
        config_extra,
        array['drive_export_negocios'],
        (config_extra -> 'drive_export_negocios') - 'file_id',
        true
      )
  where id = p_workspace_id
    and config_extra #>> '{drive_export_negocios,file_id}' = p_file_id;

  get diagnostics v_filas = row_count;
  return v_filas > 0;
end;
$function$;

comment on function soltar_export_negocios_file_id is
  'Suelta el file_id de la hoja de Drive de negocios, solo si sigue siendo el que se pasa (compara-y-suelta). Se usa cuando el archivo guardado quedo borrado o en la papelera.';

revoke execute on function soltar_export_negocios_file_id(uuid, text) from public, anon;
grant execute on function soltar_export_negocios_file_id(uuid, text) to service_role;
