-- audit_flujo_coherencia v2 — el guardián sigue la cadena de derivación.
--
-- QUÉ CAMBIA Y POR QUÉ
-- La v1 exige que el campo que decide una ruta sea obligatorio, viva en un bloque que
-- retiene y no sea un control binario. Correcto mientras ese campo sea una PREGUNTA.
--
-- Desde `lock_when.mapping` (objetivo O3) un campo puede ser una CONSECUENCIA: el usuario
-- responde una sola pregunta y el motor sigue leyendo los campos de siempre, derivados de
-- esa respuesta. Ahí las tres exigencias siguen siendo válidas, pero **no se le piden al
-- campo derivado: se le piden a su fuente**. Un derivado nunca es obligatorio (nadie lo
-- responde) ni deja de ser un toggle (el routing lo lee booleano), así que la v1 lo
-- reportaría en rojo para siempre.
--
-- Eso deja dos salidas malas y una buena. Malas: convivir con hallazgos que ya están
-- resueltos (un guardián que hay que interpretar deja de servir), o marcar `required: true`
-- un campo que nadie responde — el verde por construcción que esta familia de guardianes
-- existe para impedir. Buena: que el guardián sepa lo que sabe el motor, o sea seguir la
-- derivación hasta la pregunta real y exigirle A ELLA.
--
-- Se agrega además una clase: una derivación cuya fuente no existe es MÁS grave que un
-- campo sin dueño, porque en pantalla no se nota — el campo se ve, con su valor viejo.
--
-- Reglas sin cambio: 1 (sin dueño), 5 (gate decorativo), 6 (el default cierra), 7 (casilla
-- ausente). En particular la 5 se deja intacta a propósito: un bloque marcado como gate que
-- no retiene sigue siendo un gate decorativo aunque sus campos sean derivados. Lo que hay
-- que corregir ahí es la configuración (quitarle `es_gate`), no el guardián.

create or replace function audit_flujo_coherencia(p_linea_id uuid)
returns table (
  severidad   text,   -- 'critico' | 'alto' | 'medio'
  clase       text,
  etapa_orden int,
  etapa       text,
  detalle     text,
  afectados   int,
  ok          boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  -- Campos que gobiernan una bifurcación, con la etapa de la que se leen.
  with decisorios as (
    select distinct
      e.orden as etapa_decide,
      e.nombre as etapa,
      c->'condition'->>'field' as campo,
      coalesce((e.config_extra->'routing'->>'source_etapa_orden')::int, e.orden) as etapa_fuente
    from etapas_negocio e
    cross join lateral jsonb_array_elements(coalesce(e.config_extra->'routing'->'conditional','[]'::jsonb)) c
    where e.linea_id = p_linea_id and e.is_active
      and c->'condition'->>'field' is not null
  ),
  -- El bloque dueño del campo: el que lo declara en sus `fields`.
  dueno as (
    select d.*, bc.id as bloque_id, bc.nombre as bloque, bc.es_gate,
           f->>'tipo' as tipo, (f->>'required')::boolean as required,
           f->'lock_when' as lock_when
    from decisorios d
    left join etapas_negocio ef on ef.linea_id = p_linea_id and ef.orden = d.etapa_fuente
    left join bloque_configs bc on bc.etapa_id = ef.id
         and exists (select 1 from jsonb_array_elements(coalesce(bc.config_extra->'fields','[]'::jsonb)) x
                     where x->>'slug' = d.campo)
    left join lateral jsonb_array_elements(coalesce(bc.config_extra->'fields','[]'::jsonb)) f
         on f->>'slug' = d.campo
  ),
  -- A quién se le exige de verdad. Si el campo es derivado (`lock_when.mapping`), la
  -- obligatoriedad, el gate y el tipo de control se le piden a la PREGUNTA de la que
  -- depende, no a él.
  exigible as (
    select
      d.etapa_decide, d.etapa, d.campo, d.etapa_fuente, d.bloque_id, d.bloque,
      coalesce(d.lock_when ? 'mapping', false) as es_derivado,
      d.lock_when->>'source_bloque_slug' as fuente_bloque,
      d.lock_when->>'field' as fuente_campo,
      (ff is not null) as fuente_existe,
      coalesce(bf.nombre, d.bloque) as bloque_ex,
      coalesce(bf.es_gate, d.es_gate) as es_gate_ex,
      coalesce(ff->>'tipo', d.tipo) as tipo_ex,
      coalesce((ff->>'required')::boolean, d.required) as required_ex
    from dueno d
    left join bloque_configs bf
      on coalesce(d.lock_when ? 'mapping', false)
     and bf.slug = d.lock_when->>'source_bloque_slug'
     and bf.etapa_id in (select id from etapas_negocio where linea_id = p_linea_id and is_active)
    left join lateral jsonb_array_elements(coalesce(bf.config_extra->'fields','[]'::jsonb)) ff
      on ff->>'slug' = d.lock_when->>'field'
  )

  -- 1. CRÍTICO — el campo que decide no existe en ningún bloque de su etapa fuente.
  --    Nadie puede responderlo, así que la decisión SIEMPRE cae al default.
  select 'critico', 'decision_sin_dueno', etapa_decide, etapa,
         format('El campo "%s" que decide la ruta no existe en ningún bloque de la etapa %s', campo, etapa_fuente),
         1, false
  from exigible where bloque_id is null

  union all
  -- 1b. CRÍTICO — el campo se declara derivado de una pregunta que no existe. Peor que no
  --     tener dueño: en pantalla el campo SE VE, con el último valor que le quedó, así que
  --     nada delata que su fuente desapareció o cambió de slug.
  select 'critico', 'derivacion_sin_fuente', etapa_decide, etapa,
         format('El campo "%s" se deriva de "%s.%s", que no existe en esta línea',
                campo, fuente_bloque, fuente_campo),
         1, false
  from exigible where bloque_id is not null and es_derivado and not fuente_existe

  union all
  -- 2. CRÍTICO — el campo decide pero no es obligatorio: se puede avanzar sin responderlo
  --    y el motor lee el vacío como si fuera una respuesta.
  select 'critico', 'decision_no_obligatoria', etapa_decide, etapa,
         case when es_derivado
           then format('El campo "%s" se deriva de "%s" (bloque "%s"), que NO es obligatorio',
                       campo, fuente_campo, bloque_ex)
           else format('El campo "%s" (bloque "%s") decide la ruta pero NO es obligatorio',
                       campo, bloque_ex)
         end,
         1, false
  from exigible
  where bloque_id is not null
    and not (es_derivado and not fuente_existe)
    and required_ex is distinct from true

  union all
  -- 3. ALTO — el bloque que contiene la decisión no retiene: se puede salir de la etapa
  --    sin haberlo diligenciado.
  select 'alto', 'decision_en_bloque_sin_gate', etapa_decide, etapa,
         case when es_derivado
           then format('El campo "%s" decide la ruta pero el bloque "%s", donde se responde, no es gate',
                       campo, bloque_ex)
           else format('El campo "%s" decide la ruta pero su bloque "%s" no es gate', campo, bloque_ex)
         end,
         1, false
  from exigible
  where bloque_id is not null
    and not (es_derivado and not fuente_existe)
    and not es_gate_ex

  union all
  -- 4. ALTO — un `toggle`/`checkbox` no sabe decir "todavía no me han respondido": nace en
  --    falso, y falso es indistinguible de una respuesta negativa deliberada. Un control
  --    así vuelve INAPLICABLE la premisa (hallazgo de Noor, 2026-07-31). Para decidir una
  --    ruta el control debe tener tres estados: sin responder, sí, no.
  --    Si el campo es derivado, el control que importa es el de la pregunta: que el motor
  --    lea un booleano deja de ser un problema cuando nadie lo responde a mano.
  select 'alto', 'decision_con_control_binario', etapa_decide, etapa,
         format('El campo "%s" decide la ruta con un %s: no puede expresar "sin responder". Usar select/radio sin valor por defecto',
                case when es_derivado then fuente_campo else campo end, tipo_ex),
         1, false
  from exigible
  where bloque_id is not null
    and not (es_derivado and not fuente_existe)
    and tipo_ex in ('toggle','checkbox')

  union all
  -- 5. MEDIO — bloque marcado como gate cuyo ningún campo es obligatorio. Se ve como
  --    control en la pantalla y no retiene nada: el equipo confía en un freno que no existe.
  select 'medio', 'gate_decorativo', e.orden, e.nombre,
         format('El bloque "%s" es gate pero ninguno de sus campos es obligatorio', bc.nombre),
         1, false
  from bloque_configs bc
  join etapas_negocio e on e.id = bc.etapa_id
  where e.linea_id = p_linea_id and e.is_active and bc.es_gate
    and bc.config_extra ? 'fields'
    and jsonb_array_length(coalesce(bc.config_extra->'fields','[]'::jsonb)) > 0
    and not exists (
      select 1 from jsonb_array_elements(bc.config_extra->'fields') f
      where (f->>'required')::boolean is true
        and f->>'tipo' not in ('plantilla','doc_link','documentos_preview')
    )

  union all
  -- 6. CRÍTICO — el camino por defecto de una decisión desemboca en la etapa de cierre.
  --    Ahí un dato faltante no solo desvía: empuja el negocio a cerrarse. Es lo que pasó
  --    con los 17 casos que salieron de Entrega hacia Facturación.
  select 'critico', 'default_cierra_el_negocio', e.orden, e.nombre,
         format('Si falta el dato, el default manda a "%s", que es etapa de cierre', ed.nombre),
         1, false
  from etapas_negocio e
  join etapas_negocio ed on ed.linea_id = p_linea_id
       and ed.orden = (e.config_extra->'routing'->>'default_etapa_orden')::int
  where e.linea_id = p_linea_id and e.is_active
    and jsonb_array_length(coalesce(e.config_extra->'routing'->'conditional','[]'::jsonb)) > 0
    and (ed.config_extra->>'etapa_cierre')::boolean is true
    and ed.orden <> e.orden

  union all
  -- 7. ALTO — casillas GATE que no existen en negocios que SÍ recorrieron su etapa: el
  --    bloque se creó después de que pasaron. No están sin responder, no hay dónde
  --    responder. Se excluyen los condicionales (su ausencia puede ser correcta).
  select 'alto', 'casilla_gate_ausente', e.orden, e.nombre,
         format('El bloque "%s" (creado %s) no existe en negocios que ya recorrieron la etapa',
                bc.nombre, bc.created_at::date),
         count(*)::int, false
  from bloque_configs bc
  join etapas_negocio e on e.id = bc.etapa_id
  join lineas_negocio ln on ln.id = e.linea_id
  join negocios n on n.linea_id = ln.id and n.estado = 'abierto'
  where e.linea_id = p_linea_id and e.is_active and bc.es_gate
    and not (bc.config_extra ? 'condition')
    and exists (select 1 from negocio_bloques nb2
                join bloque_configs bc2 on bc2.id = nb2.bloque_config_id
                where nb2.negocio_id = n.id and bc2.etapa_id = e.id)
    and not exists (select 1 from negocio_bloques nb
                    where nb.negocio_id = n.id and nb.bloque_config_id = bc.id)
  group by e.orden, e.nombre, bc.nombre, bc.created_at

  order by 1, 3;
$$;

comment on function audit_flujo_coherencia(uuid) is
  'Verifica que las decisiones de un workflow se puedan tomar con información completa. '
  'Premisa: un campo que decide una ruta es siempre obligatorio, vive en un bloque que '
  'retiene, y el vacío no es una respuesta. Si el campo es DERIVADO (lock_when.mapping), '
  'esas tres exigencias se le piden a la pregunta de la que depende, no a él. '
  'Correr tras cualquier cambio de configuración: '
  'select * from audit_flujo_coherencia(linea_id) where not ok;';

-- Diagnóstico interno, no lo consume el cliente. `anon` nunca.
revoke all on function audit_flujo_coherencia(uuid) from anon;
grant execute on function audit_flujo_coherencia(uuid) to authenticated;
