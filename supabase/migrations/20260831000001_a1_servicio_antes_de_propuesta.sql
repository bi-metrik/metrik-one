-- A1 SOENA — "Servicio contratado" y "Titularidad" suben a Propuesta, antes de emitirla.
--
-- EL DEFECTO QUE CIERRA
-- `generarVersionPropuesta` ya consultaba `servicio_contratado` para decidir si la
-- linea de tarifa UPME entra al PDF, pero el bloque vivia en Negociacion (orden 5),
-- una etapa DESPUES de donde se genera la propuesta (orden 4). La consulta volvia
-- siempre vacia, asi que toda propuesta emitida asumia el paquete completo y a un
-- cliente de solo IVA se le cobraba la tarifa UPME igual.
--
-- POR QUE SE MUEVE EL CONFIG Y NO SE CREA UNO NUEVO EN PROPUESTA
-- `condicion_cumplida()` resuelve el bloque fuente con
-- `WHERE bc.slug = v_slug ... LIMIT 1`, sin desempate. Dos bloque_configs con el
-- mismo slug en la misma linea harian que el motor eligiera uno al azar. Un solo
-- config por slug es invariante del diseno, no preferencia de estilo.
-- Mover el config arrastra sus instancias: `negocio_bloques` apunta a
-- `bloque_config_id` y NO guarda etapa, asi que las 314 respuestas ya capturadas
-- viajan intactas.
--
-- POR QUE ESTO NO ROMPE LAS 20 REFERENCIAS QUE APUNTAN A LA ETAPA 5
-- Medido antes de escribir: las ~20 referencias a estos dos slugs (condiciones de
-- Contrato de leasing, RUT solicitante 2, Carta de autorizacion, Certificado
-- Superfinanciera, y los `lock_when` de Devolucion de IVA y Certificacion UPME)
-- declaran SIEMPRE `source_bloque_slug` ademas de `source_etapa_orden`, y las cuatro
-- vias de resolucion prefieren el slug:
--   - `resolverFuente` (condicion-bloque.ts) — slug primero
--   - `condicion_cumplida()` en SQL — slug primero, y busca por LINEA, no por etapa
--   - `opcion-condicional.ts` y `campo-derivado.ts` — el slug es REQUERIDO
-- El `source_etapa_orden: 5` sobrante quedaria inerte. Se reapunta a 4 igual, en el
-- paso 4: un puntero que dice donde el bloque YA NO vive es la clase de dato podrido
-- que se lee despues como si fuera el mapa vigente.

begin;

-- ── 1. Respaldo ────────────────────────────────────────────────────────────────
create table if not exists backup_bloque_configs_a1_20260831 as
select bc.*, now() as respaldado_at
from bloque_configs bc
join etapas_negocio e on e.id = bc.etapa_id
where e.linea_id = '34a0fa6b-9ed3-4652-a419-42601132d1a8';

-- ── 2. Los dos bloques se mudan a Propuesta, ANTES del bloque de propuesta ──────
with propuesta as (
  select id from etapas_negocio
  where linea_id = '34a0fa6b-9ed3-4652-a419-42601132d1a8' and orden = 4
),
negociacion as (
  select id from etapas_negocio
  where linea_id = '34a0fa6b-9ed3-4652-a419-42601132d1a8' and orden = 5
)
update bloque_configs bc
set etapa_id = (select id from propuesta),
    orden    = case bc.slug when 'titularidad' then 1 else 2 end
from negociacion n
where bc.etapa_id = n.id
  and bc.slug in ('titularidad', 'servicio_contratado');

-- El bloque de propuesta baja a 3: se responde DESPUES de las dos preguntas que
-- deciden que promete y que cobra.
update bloque_configs bc
set orden = case bc.slug
              when 'propuesta_economica' then 3
              when 'pagos_e4'  then 4
              when 'cobros_e4' then 5
              else bc.orden
            end
from etapas_negocio e
where e.id = bc.etapa_id
  and e.linea_id = '34a0fa6b-9ed3-4652-a419-42601132d1a8'
  and e.orden = 4
  and bc.slug in ('propuesta_economica', 'pagos_e4', 'cobros_e4');

-- ── 3. La propuesta NO se emite sin saber que contrato el cliente ───────────────
-- `requiere_bloques` es el mismo vocabulario que ya usan los formularios. Sin este
-- freno, mover el bloque solo pone la pregunta a la vista: nada obliga a contestarla
-- antes de generar, y el PDF volveria a salir asumiendo el paquete completo.
update bloque_configs bc
set config_extra = bc.config_extra || jsonb_build_object(
      'requiere_bloques',
      jsonb_build_array(
        jsonb_build_object('slug', 'servicio_contratado', 'label', 'Servicio contratado')
      )
    )
from etapas_negocio e
where e.id = bc.etapa_id
  and e.linea_id = '34a0fa6b-9ed3-4652-a419-42601132d1a8'
  and bc.slug = 'propuesta_economica';

-- ── 4. Reapuntar los `source_etapa_orden` de 5 a 4 ─────────────────────────────
-- Recursiva y acotada: solo toca objetos que referencian a ESTOS dos slugs y que
-- ademas dicen 5. Cualquier otra referencia a la etapa 5 (Negociacion sigue
-- existiendo y teniendo bloques) se queda como esta.
create or replace function public._a1_reapuntar(p jsonb, p_slugs text[], p_de int, p_a int)
returns jsonb language sql immutable as $$
  select case jsonb_typeof(p)
    when 'object' then (
      select coalesce(jsonb_object_agg(k, public._a1_reapuntar(v, p_slugs, p_de, p_a)), '{}'::jsonb)
      from jsonb_each(p) as e(k, v)
    ) || (
      case
        when p->>'source_bloque_slug' = any(p_slugs)
         and p->>'source_etapa_orden' ~ '^[0-9]+$'
         and (p->>'source_etapa_orden')::int = p_de
        then jsonb_build_object('source_etapa_orden', p_a)
        else '{}'::jsonb
      end
    )
    when 'array' then (
      select coalesce(jsonb_agg(public._a1_reapuntar(v, p_slugs, p_de, p_a)), '[]'::jsonb)
      from jsonb_array_elements(p) as a(v)
    )
    else p
  end
$$;

update bloque_configs bc
set config_extra = public._a1_reapuntar(
      bc.config_extra, array['titularidad', 'servicio_contratado'], 5, 4
    )
from etapas_negocio e
where e.id = bc.etapa_id
  and e.linea_id = '34a0fa6b-9ed3-4652-a419-42601132d1a8'
  and bc.config_extra::text like '%source_etapa_orden%';

drop function public._a1_reapuntar(jsonb, text[], int, int);

commit;
