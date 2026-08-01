-- audit_flujo_coherencia(linea_id) — el guardián que faltaba.
--
-- Tercero de la familia. `audit_workflow_refs` valida que las referencias entre bloques
-- apunten a donde creen; `audit_block_slug_refs` valida la identidad de esas referencias.
-- Este valida algo distinto y más caro de descubrir a mano: **que las decisiones del flujo
-- se puedan tomar con información completa**.
--
-- POR QUÉ EXISTE
-- Seis incidentes en dos semanas en SOENA, todos la misma historia: el motor siguió
-- adelante con un dato que no tenía y nos enteramos por un caso suelto que alguien vio
-- raro. Un negocio quieto ocho días sin estar bloqueado (V0107), cuatro casos de solo IVA
-- sin dónde declararse, diecisiete que salieron de Entrega hacia la etapa de cierre
-- saltándose la devolución, siete gates que no retenían nada. Ninguno dio error: todos
-- pasaron por rutas que el sistema creyó correctas.
--
-- LA PREMISA QUE VERIFICA (decisión de Mauricio, 2026-07-31)
--   Un campo que decide una ruta es SIEMPRE obligatorio, vive en un bloque que retiene,
--   y ninguna decisión se evalúa sin él. El vacío no es una respuesta.
--
-- Correrlo después de CUALQUIER cambio de configuración de un workflow:
--   select * from audit_flujo_coherencia('<linea_id>') where not ok;
-- Vacío = sano. Es el mismo contrato de uso que sus dos hermanas.
--
-- Es de diagnóstico: solo lee configuración y datos, no escribe nada.

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
           f->>'tipo' as tipo, (f->>'required')::boolean as required
    from decisorios d
    left join etapas_negocio ef on ef.linea_id = p_linea_id and ef.orden = d.etapa_fuente
    left join bloque_configs bc on bc.etapa_id = ef.id
         and exists (select 1 from jsonb_array_elements(coalesce(bc.config_extra->'fields','[]'::jsonb)) x
                     where x->>'slug' = d.campo)
    left join lateral jsonb_array_elements(coalesce(bc.config_extra->'fields','[]'::jsonb)) f
         on f->>'slug' = d.campo
  )

  -- 1. CRÍTICO — el campo que decide no existe en ningún bloque de su etapa fuente.
  --    Nadie puede responderlo, así que la decisión SIEMPRE cae al default.
  select 'critico', 'decision_sin_dueno', etapa_decide, etapa,
         format('El campo "%s" que decide la ruta no existe en ningún bloque de la etapa %s', campo, etapa_fuente),
         1, false
  from dueno where bloque_id is null

  union all
  -- 2. CRÍTICO — el campo decide pero no es obligatorio: se puede avanzar sin responderlo
  --    y el motor lee el vacío como si fuera una respuesta.
  select 'critico', 'decision_no_obligatoria', etapa_decide, etapa,
         format('El campo "%s" (bloque "%s") decide la ruta pero NO es obligatorio', campo, bloque),
         1, false
  from dueno where bloque_id is not null and required is distinct from true

  union all
  -- 3. ALTO — el bloque que contiene la decisión no retiene: se puede salir de la etapa
  --    sin haberlo diligenciado.
  select 'alto', 'decision_en_bloque_sin_gate', etapa_decide, etapa,
         format('El campo "%s" decide la ruta pero su bloque "%s" no es gate', campo, bloque),
         1, false
  from dueno where bloque_id is not null and not es_gate

  union all
  -- 4. ALTO — un `toggle`/`checkbox` no sabe decir "todavía no me han respondido": nace en
  --    falso, y falso es indistinguible de una respuesta negativa deliberada. Un control
  --    así vuelve INAPLICABLE la premisa (hallazgo de Noor, 2026-07-31). Para decidir una
  --    ruta el control debe tener tres estados: sin responder, sí, no.
  select 'alto', 'decision_con_control_binario', etapa_decide, etapa,
         format('El campo "%s" decide la ruta con un %s: no puede expresar "sin responder". Usar select/radio sin valor por defecto', campo, tipo),
         1, false
  from dueno where tipo in ('toggle','checkbox')

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
  'retiene, y el vacío no es una respuesta. Correr tras cualquier cambio de configuración: '
  'select * from audit_flujo_coherencia(linea_id) where not ok;';

-- Diagnóstico interno, no lo consume el cliente. `anon` nunca.
revoke all on function audit_flujo_coherencia(uuid) from anon;
grant execute on function audit_flujo_coherencia(uuid) to authenticated;
