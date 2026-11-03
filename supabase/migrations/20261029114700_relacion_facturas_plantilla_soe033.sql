-- Relación de facturas: `campos_fuente` para la plantilla que SOENA envió el 2026-10-28
-- (Deisy Ramírez, directora operativa; ticket SOE-033). Mauricio aprobó usarla TAL CUAL.
--
-- La plantilla nueva es una FICHA por factura que imprime tres datos que la Relación no
-- recibía: la fecha de expedición de la factura (`fecha_factura`) y el número y la fecha
-- del certificado UPME (`numero_caso_upme`, `fecha_certificado`). Esta migración se los
-- agrega a `campos_fuente`. El componente (`src/lib/pdf/relacion-facturas-pdf.tsx`) ya los
-- lee como opcionales, así que el orden merge ⟷ migración no rompe nada: sin la migración
-- la ficha sale con «—» en esas tres casillas.
--
-- Esto es CONFIGURACIÓN: toca `bloque_configs.config_extra` y **no escribe una sola fila de
-- `negocio_bloques`**, así que ningún expediente cambia de contenido. Los documentos ya
-- generados quedan como están hasta que alguien los regenere.
--
-- LAS FUENTES SE COPIAN DE LA DECLARACIÓN JURAMENTADA VIVA (f2878f39), no se transcriben.
-- La Relación y la declaración van juntas a la DIAN y citan la misma factura y el mismo
-- certificado: tienen que leerlos del mismo lugar. Copiar las tres entradas con un
-- `select` sobre la config de la declaración garantiza eso, incluido el
-- `source_alternatives` hacia `concepto_upme_anexos` (Anexos, etapa 18) que agregó
-- 20260907214136 para la rama «solo IVA». Un JSON retipeado a mano es donde se cuelan las
-- diferencias que no se ven en la revisión del PR.
--
-- Qué entra como `optional: true`: `numero_caso_upme` y `fecha_certificado`, igual que en
-- la declaración. Un campo no opcional sin valor IMPIDE generar el PDF (`faltantes` en
-- `resolverCamposFuente`), y la Relación nunca dependió del certificado para generarse.
-- `fecha_factura` entra como está en la declaración (obligatoria): la Relación ya exige el
-- número de factura y los valores de la misma factura, y la declaración —que va en el
-- mismo paquete— ya frena sin esa fecha.
--
-- Qué bloques: `relacion_de_facturas` (Generación, 123b34e1) y, si todavía tiene su propia
-- config de formulario, su copia de Envío `relacion_de_facturas_envio` (2f7c6a0b), que
-- nació en 20260624 como copia con el mismo `config_extra`. Dejar la copia con la fuente
-- vieja produciría dos versiones del mismo papel según desde qué etapa se genere. Si la
-- copia ya no declara el template (hereda del origen), no se toca. La de Generación es
-- obligatoria: si no se actualiza, la migración aborta.
--
-- Idempotente: si los tres campos ya existen se reemplazan por la copia vigente de la
-- declaración, nunca se duplican.

begin;

-- Respaldo de la configuración vigente. `bloque_configs` es catálogo, no datos de negocio,
-- pero un `config_extra` reescrito no se puede reconstruir desde ninguna otra parte.
-- server-only: respaldo de configuración; lo lee una persona por SQL si hay que revertir.
create table if not exists public.backup_relacion_facturas_soe033_20261029 as
select id, slug, config_extra, now() as respaldado_en
from public.bloque_configs
where id in (
  '123b34e1-11bf-4965-9bff-b1ed29013782',  -- relacion_de_facturas (Generación)
  '2f7c6a0b-ad61-48c4-97d7-fd0289014d15'   -- relacion_de_facturas_envio (Envío)
);

alter table public.backup_relacion_facturas_soe033_20261029 enable row level security;

do $$
declare
  v_slugs constant text[] := array['fecha_factura', 'numero_caso_upme', 'fecha_certificado'];
  v_nuevos jsonb;
  v_filas int;
  v_ok int;
begin
  -- 1. Las tres entradas, tal cual están en la declaración juramentada de Generación.
  select jsonb_agg(
           case
             when c->>'slug' in ('numero_caso_upme', 'fecha_certificado')
             then c || '{"optional": true}'::jsonb
             else c
           end
           order by array_position(v_slugs, c->>'slug')
         )
    into v_nuevos
  from public.bloque_configs dj,
       lateral jsonb_array_elements(dj.config_extra->'campos_fuente') c
  where dj.id = 'f2878f39-5f3a-4067-abe2-3d15ba1a1c03'
    and dj.config_extra->>'template' = 'declaracion-juramentada'
    and c->>'slug' = any(v_slugs);

  if coalesce(jsonb_array_length(v_nuevos), 0) <> 3 then
    raise exception
      'La declaración juramentada (f2878f39) no tiene los 3 campos a copiar; encontrados: %',
      coalesce(jsonb_array_length(v_nuevos), 0);
  end if;

  -- El certificado tiene que traer su alternativa de Anexos: sin ella la rama «solo IVA»
  -- quedaría sin radicado en la Relación aunque el cliente lo haya entregado.
  select count(*) into v_ok
  from jsonb_array_elements(v_nuevos) c
  where c->>'slug' in ('numero_caso_upme', 'fecha_certificado')
    and c->'source'->>'bloque_slug' = 'concepto_upme'
    and c->'source_alternatives' @> '[{"bloque_slug": "concepto_upme_anexos"}]'::jsonb;

  if v_ok <> 2 then
    raise exception
      'Los campos UPME de la declaración no tienen la fuente esperada (concepto_upme + concepto_upme_anexos); calzan %', v_ok;
  end if;

  -- 2. Se quitan las entradas con esos slugs (si las hubiera) y se agregan al final.
  update public.bloque_configs bc
     set config_extra = jsonb_set(
           bc.config_extra,
           '{campos_fuente}',
           coalesce(
             (
               select jsonb_agg(c order by ord)
               from jsonb_array_elements(bc.config_extra->'campos_fuente') with ordinality as t(c, ord)
               where not (c->>'slug' = any(v_slugs))
             ),
             '[]'::jsonb
           ) || v_nuevos
         )
   where bc.id in (
           '123b34e1-11bf-4965-9bff-b1ed29013782',
           '2f7c6a0b-ad61-48c4-97d7-fd0289014d15'
         )
     and bc.workspace_id = '7dea141d-d4da-483d-a78d-b14ef35500c5'  -- SOENA
     and bc.config_extra->>'template' = 'relacion-facturas'
     and jsonb_typeof(bc.config_extra->'campos_fuente') = 'array';

  get diagnostics v_filas = row_count;
  raise notice 'relacion-facturas: % bloque(s) actualizado(s)', v_filas;

  -- 3. Verificación en sentencia aparte. La de Generación es obligatoria; y todo bloque
  --    tocado tiene que quedar con los tres campos UNA vez y el certificado opcional.
  if not exists (
    select 1 from public.bloque_configs
    where id = '123b34e1-11bf-4965-9bff-b1ed29013782'
      and config_extra->>'template' = 'relacion-facturas'
  ) then
    raise exception 'relacion_de_facturas (123b34e1) no existe o cambió de template';
  end if;

  select count(*) into v_ok
  from public.bloque_configs bc
  where bc.id in (
          '123b34e1-11bf-4965-9bff-b1ed29013782',
          '2f7c6a0b-ad61-48c4-97d7-fd0289014d15'
        )
    and bc.config_extra->>'template' = 'relacion-facturas'
    and (select count(*) from jsonb_array_elements(bc.config_extra->'campos_fuente') c
         where c->>'slug' = any(v_slugs)) = 3
    and (select count(*) from jsonb_array_elements(bc.config_extra->'campos_fuente') c
         where c->>'slug' in ('numero_caso_upme', 'fecha_certificado')
           and (c->>'optional')::boolean is true) = 2;

  if v_ok <> v_filas or v_filas < 1 then
    raise exception
      'Se actualizaron % bloque(s) pero solo % quedaron con los 3 campos y el certificado opcional',
      v_filas, v_ok;
  end if;
end $$;

commit;

-- ── Para revertir ───────────────────────────────────────────────────────────
-- update public.bloque_configs bc set config_extra = b.config_extra
--   from public.backup_relacion_facturas_soe033_20261029 b where b.id = bc.id;
