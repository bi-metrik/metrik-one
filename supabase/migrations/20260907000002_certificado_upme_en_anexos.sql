-- El certificado UPME también se pide en Anexos, para la rama «solo devolución de IVA».
--
-- LA REGLA DE NEGOCIO (Mauricio, 2026-09-07, textual)
--   «para hacer solo devolución de iva el cliente debe entregar el certificado de la upme
--    en la etapa de anexos»
--
-- O sea: en la rama solo IVA el certificado SIEMPRE existe. Hasta hoy la plataforma no lo
-- pedía en ningún lado: el único bloque que captura radicado y fecha es `concepto_upme`
-- (`004_CERTIFICADO_UPME`), que vive en Certificación (etapa orden 9), y el routing de
-- Documentación manda la rama solo IVA a la etapa 10 —o sea se salta Cargue (7), Pago UPME
-- (8) y Certificación (9)—. El hueco era de configuración del flujo, no del PDF.
--
-- QUÉ HACE ESTA MIGRACIÓN
--   1. Crea en Anexos (etapa orden 18) una casilla de documento para el certificado UPME,
--      condicionada a `servicio = solo_iva`, COPIANDO la fila de `concepto_upme`: misma
--      definición, mismo `drive_subfolder` («3. UPME»), mismo `label`
--      («004_CERTIFICADO_UPME»), los mismos 9 `campos_extraccion` y el mismo `cross_check`.
--      Se copia con un `insert … select` en vez de transcribir el JSON a propósito: un
--      `config_extra` de este tamaño retipeado a mano es donde se cuelan las diferencias
--      que no se ven en la revisión del PR.
--   2. Le agrega a `numero_caso_upme` y `fecha_certificado` de la declaración juramentada
--      un `source_alternatives` hacia esa casilla nueva. La fuente PRINCIPAL sigue siendo
--      `concepto_upme` (etapa 9); el bloque de Anexos entra solo cuando aquella viene
--      vacía. Es el mismo patrón que ya usan `marca` y `linea` en este mismo bloque.
--
-- ⚠️ ESTA MIGRACIÓN SÍ TOCA DATOS DE PRODUCCIÓN, a diferencia de la 20260907000001.
-- El trigger `sembrar_casillas_al_crear_bloque` crea la casilla vacía en todo negocio
-- ABIERTO que ya haya visitado la etapa, y lo hace SIN mirar la `condition` del bloque.
-- Medido contra producción el 2026-09-07, sobre los 401 negocios abiertos de la línea
-- GIT EV/HEV:
--
--   · 264 negocios abiertos ya visitaron Anexos  →  264 filas nuevas en `negocio_bloques`
--     (249 con servicio «completo», 11 «solo_iva», 4 sin el bloque de servicio respondido)
--   · las 253 filas que no son solo_iva nacen INERTES: la `condition` no se cumple, así que
--     el bloque no se dibuja y el gate —si algún día lo tiene— tampoco aplica. Es el mismo
--     comportamiento que ya tienen `certificado_bancario` (276 filas) y
--     `carta_autorizacion_notariada` (140 filas, solo 2 completas).
--   · los 9 negocios solo_iva que aún no llegan a Anexos los cubre el auto-init al entrar.
--
-- POR QUÉ NO NACE COMO GATE, aunque `concepto_upme` sí lo es
-- Medido el mismo día: de los 20 negocios abiertos solo_iva, **16 YA tienen el certificado
-- cargado bajo `concepto_upme`** (Certificación), con su radicado extraído. Son casos que
-- recorrieron el flujo antes de que existiera la bifurcación por servicio (el bloque
-- `servicio_contratado` nació el 2026-08-03) o que la respondieron después de pasar por
-- Documentación. Un gate aquí le pediría a esos 16 subir por segunda vez un documento que
-- el expediente ya tiene, y retendría hoy mismo a V0238 —el único solo_iva parado en
-- Anexos— que además ya tiene su radicado (VEH_GEE202625130). Con la casilla visible y sin
-- gate, la plataforma PIDE el documento sin frenar a quien ya lo entregó por la otra vía.
-- Volverlo obligatorio después es una sola línea (`es_gate = true`), y para entonces el
-- número de casos con certificado duplicado será medible de nuevo.
--
-- LO QUE ESTA MIGRACIÓN NO RESUELVE
-- Los 4 negocios abiertos solo_iva que hoy no tienen radicado en ninguna parte —V0107,
-- V0255, V0283 y V0284— son los únicos a los que el cambio les mueve el documento. V0107
-- ya visitó Anexos, así que recibe la casilla sembrada; los otros tres están en
-- Notificación (orden 17) y la reciben por auto-init al entrar a Anexos (orden 18). A
-- ninguno hay que tocarle nada a mano: lo que falta es que el cliente suba el certificado.

begin;

-- Respaldo de la configuración vigente de los dos bloques de la declaración. `bloque_configs`
-- es catálogo y no datos de negocio, pero un `config_extra` reescrito no se reconstruye
-- desde ninguna otra parte.
-- server-only: respaldo de configuración; lo lee una persona por SQL si hay que revertir.
create table if not exists public.backup_certificado_upme_anexos_20260907 as
select id, slug, config_extra, now() as respaldado_en
from public.bloque_configs
where id in (
  'f2878f39-5f3a-4067-abe2-3d15ba1a1c03',  -- declaracion_juramentada (Generación)
  '649b426c-01b8-4b56-8c13-b49100b01a75'   -- declaracion_juramentada_envio (Envío)
);

alter table public.backup_certificado_upme_anexos_20260907 enable row level security;

-- ── 1. La casilla nueva en Anexos, copiada de `concepto_upme` ────────────────
do $$
declare
  v_creadas int;
  v_sembradas int;
begin
  insert into public.bloque_configs (
    etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate,
    nombre, slug, config_extra
  )
  select
    '2e23c1e2-96a2-473d-a476-d7c15ccabfac',  -- Anexos (orden 18, número visible 15)
    bc.workspace_id,
    bc.bloque_definition_id,                 -- misma definición: tipo `documento`
    'editable',
    10,                                      -- antes de certificado_bancario (11)
    false,                                   -- ver «POR QUÉ NO NACE COMO GATE» arriba
    'Concepto UPME',
    'concepto_upme_anexos',
    -- Todo lo que hace que la extracción y el archivado se comporten igual viaja tal cual
    -- desde el bloque original: `label`, `drive_subfolder`, `campos_extraccion`,
    -- `cross_check` (que es `solo_alerta`, así que nunca frena) y
    -- `corregir_campos_gerencial`. Encima se le agrega la condición de rama.
    bc.config_extra || jsonb_build_object(
      'condition', jsonb_build_object(
        'field', 'servicio',
        'value', 'solo_iva',
        'source_bloque_slug', 'servicio_contratado',
        'source_etapa_orden', 4
      )
    )
  from public.bloque_configs bc
  where bc.id = '989f3bca-3d72-4470-94c9-9e1da7f267eb'  -- concepto_upme (Certificación)
    -- Idempotencia: si el bloque ya existe, no se crea otro (el `slug` es único por línea
    -- y un duplicado rompería `audit_block_slug_refs` y la resolución por slug).
    and not exists (
      select 1
      from public.bloque_configs x
      where x.etapa_id = '2e23c1e2-96a2-473d-a476-d7c15ccabfac'
        and x.slug = 'concepto_upme_anexos'
    );

  get diagnostics v_creadas = row_count;

  -- Aborta si el bloque origen no existe o cambió de id: copiar de la nada crearía una
  -- casilla sin `campos_extraccion`, que es un documento que se carga y no extrae nada.
  if v_creadas = 0 and not exists (
    select 1 from public.bloque_configs x
    where x.etapa_id = '2e23c1e2-96a2-473d-a476-d7c15ccabfac'
      and x.slug = 'concepto_upme_anexos'
  ) then
    raise exception
      'No se creó la casilla de Anexos: el bloque origen concepto_upme (989f3bca-…) no existe';
  end if;

  -- Cuántas casillas sembró el trigger. Se deja en el log de la migración porque es la
  -- única escritura sobre datos de producción que hace este archivo.
  select count(*) into v_sembradas
  from public.negocio_bloques nb
  join public.bloque_configs bc on bc.id = nb.bloque_config_id
  where bc.etapa_id = '2e23c1e2-96a2-473d-a476-d7c15ccabfac'
    and bc.slug = 'concepto_upme_anexos';

  raise notice 'concepto_upme_anexos: % bloque_configs creado(s), % casillas sembradas',
    v_creadas, v_sembradas;
end $$;

-- ── 2. La declaración juramentada aprende a leer el certificado de Anexos ────
do $$
declare
  v_filas int;
  v_ok int;
begin
  -- Edición quirúrgica: se recorre `campos_fuente` y solo a los dos campos del certificado
  -- se les añade la alternativa. Reescribir el arreglo entero obligaría a retipear las 18
  -- entradas, y ahí es donde se pierde una sin que nadie lo note.
  update public.bloque_configs bc
     set config_extra = jsonb_set(
           bc.config_extra,
           '{campos_fuente}',
           (
             select jsonb_agg(
                      case
                        when c->>'slug' in ('numero_caso_upme', 'fecha_certificado')
                        then c || jsonb_build_object(
                               'source_alternatives',
                               jsonb_build_array(jsonb_build_object(
                                 'tipo', 'ai',
                                 'campo_slug', c->>'slug',
                                 'bloque_slug', 'concepto_upme_anexos',
                                 'etapa_orden', 18,
                                 'bloque_orden', 10
                               ))
                             )
                        else c
                      end
                      order by ord
                    )
             from jsonb_array_elements(bc.config_extra->'campos_fuente')
                  with ordinality as t(c, ord)
           )
         )
   where bc.id in (
           'f2878f39-5f3a-4067-abe2-3d15ba1a1c03',
           '649b426c-01b8-4b56-8c13-b49100b01a75'
         )
     and bc.config_extra->>'template' = 'declaracion-juramentada';

  get diagnostics v_filas = row_count;

  -- Los dos bloques emiten el MISMO papel: dejar uno leyendo solo Certificación produciría
  -- dos versiones del mismo documento según desde qué etapa se genere.
  if v_filas <> 2 then
    raise exception
      'Se esperaban 2 bloques con template declaracion-juramentada, se actualizaron %', v_filas;
  end if;

  -- Verificación en sentencia aparte: que las 4 entradas (2 campos × 2 bloques) quedaron
  -- con su alternativa. Sin esto, un `jsonb_set` que no encuentra la ruta se ve igual que
  -- uno que sí escribió.
  select count(*) into v_ok
  from public.bloque_configs bc,
       lateral jsonb_array_elements(bc.config_extra->'campos_fuente') c
  where bc.id in (
          'f2878f39-5f3a-4067-abe2-3d15ba1a1c03',
          '649b426c-01b8-4b56-8c13-b49100b01a75'
        )
    and c->>'slug' in ('numero_caso_upme', 'fecha_certificado')
    and c->'source_alternatives'->0->>'bloque_slug' = 'concepto_upme_anexos';

  if v_ok <> 4 then
    raise exception
      'Se esperaban 4 campos con la alternativa a concepto_upme_anexos, quedaron %', v_ok;
  end if;
end $$;

commit;

-- ── Para revertir ───────────────────────────────────────────────────────────
-- 1. delete from negocio_bloques where bloque_config_id = (
--      select id from bloque_configs
--      where etapa_id = '2e23c1e2-96a2-473d-a476-d7c15ccabfac' and slug = 'concepto_upme_anexos');
--    ⚠️ Si alguien ya cargó un certificado ahí, ese archivo queda huérfano en Drive: mirar
--    `drive_url` de esas filas antes de borrarlas.
-- 2. delete from bloque_configs
--      where etapa_id = '2e23c1e2-96a2-473d-a476-d7c15ccabfac' and slug = 'concepto_upme_anexos';
-- 3. update bloque_configs bc set config_extra = b.config_extra
--      from public.backup_certificado_upme_anexos_20260907 b where b.id = bc.id;
