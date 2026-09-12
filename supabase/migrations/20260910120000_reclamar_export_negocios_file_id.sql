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
--      proceso acabe de escribir en OTRA rama del jsonb. Una sola sentencia no puede:
--      toca su rama y deja el resto intacto. Mismo motivo por el que existe
--      `guardar_field_map_formulario` (20260903000001).
--
--      ⚠️ Pero OJO con la forma de tocar esa rama: la obvia, `jsonb_set` con
--      `create_if_missing`, NO crea el objeto contenedor y deja el id sin guardar sin
--      dar error. Ver el bloque de `||` dentro de `reclamar_...`.
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

  -- ⚠️ Se construye con `||`, NO con `jsonb_set(..., create_if_missing => true)`.
  --
  -- `create_if_missing` crea SOLO el ultimo escalon del camino. PostgreSQL lo documenta
  -- en el propio `jsonb_set`: «All earlier steps in the path must exist, or the target is
  -- returned unchanged». En el camino {drive_export_negocios, file_id} el escalon
  -- anterior es el objeto contenedor, y hoy NINGUN workspace lo tiene porque la
  -- funcionalidad es nueva. Peor: el `where` de abajo se cumple EXACTAMENTE cuando esa
  -- llave falta, asi que el camino roto no seria un borde raro, seria el caso por
  -- defecto — el primer clic de cada workspace.
  --
  -- Y falla CALLADO, que es peor que fallar: `jsonb_set` devuelve el jsonb intacto, el
  -- update reporta su fila, el `returning` da null y quien llama recibe «no hay id»
  -- sobre un archivo que si se creo. El usuario ve un enlace que funciona y el clic
  -- siguiente crea OTRA hoja, dejando huerfana la anterior. (Mismo gotcha ya medido en
  -- este repo: el backfill de `_reconstruido` dejo 724 filas con el valor y 0 con la
  -- marca.)
  --
  -- El `||` entre objetos es una fusion SUPERFICIAL: reemplaza solo la llave que se le
  -- pasa, asi que los hermanos de `config_extra` (`siigo_*`, `meta_leads`,
  -- `negocio_card`) quedan intactos — que es la razon 2 de la cabecera — y el `||` de
  -- adentro conserva lo que ya hubiera DENTRO del contenedor, en particular
  -- `compartir_con`, que lo escribe una persona y no se puede perder al guardar un id.
  update workspaces
  set config_extra =
        coalesce(config_extra, '{}'::jsonb)
        || jsonb_build_object(
             'drive_export_negocios',
             -- Si la llave existe y NO es un objeto (una edicion a mano), se parte de
             -- `{}`: concatenar un escalar con un objeto no falla, devuelve un arreglo,
             -- y eso dejaria la config peor de como estaba.
             (case
                when jsonb_typeof(config_extra -> 'drive_export_negocios') = 'object'
                  then config_extra -> 'drive_export_negocios'
                else '{}'::jsonb
              end)
             || jsonb_build_object('file_id', btrim(p_file_id))
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

-- ⚠️ `from public, anon` NO alcanza: en este proyecto `authenticated` tiene EXECUTE por
-- privilegios por defecto del esquema, y revocarle a PUBLIC no le quita su concesion propia.
-- Corregido en 20260912100000. Si copias de aqui, revoca tambien a `authenticated`.
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
  -- Aqui `jsonb_set` SI es correcto, y la diferencia con el reclamo de arriba vale la
  -- pena nombrarla porque es la que decide si el defecto aparece: este camino tiene UN
  -- solo escalon (`{drive_export_negocios}`), asi que el unico «paso anterior» es la raiz
  -- del jsonb, que siempre existe. Y ademas el `where` exige que la llave ya tenga
  -- `file_id`, con lo que el contenedor esta garantizado por construccion: no hay nada
  -- que crear y el `true` del final ni siquiera llega a actuar.
  --
  -- Regla para quien copie de aqui: `create_if_missing` solo alcanza si el camino tiene
  -- un escalon, o si el `where` garantiza que los anteriores existen.
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
