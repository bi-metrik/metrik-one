-- Declaración juramentada: reapunta `campos_fuente` a la plantilla que SOENA envió el
-- 2026-09-07 (Deisy Ramírez, directora operativa).
--
-- La plantilla nueva describe la compra —marca, referencia, fecha, vendedor, factura,
-- valor sin IVA e IVA— mientras la anterior era una carta sin ningún dato del vehículo.
-- Esto es CONFIGURACIÓN: toca `bloque_configs.config_extra` de dos bloques y **no escribe
-- una sola fila de `negocio_bloques`**, así que ningún expediente cambia de contenido.
--
-- Los dos bloques que usan el template van juntos a propósito: `declaracion_juramentada`
-- (etapa Generación) y `declaracion_juramentada_envio` (etapa Envío) emiten el MISMO
-- documento, y dejar uno con la fuente vieja produciría dos versiones del mismo papel.
--
-- Qué sale de `campos_fuente`: `email` y `telefono`. La plantilla nueva firma con nombre y
-- cédula únicamente, y un campo no opcional sin valor **impide generar el PDF**
-- (`faltantesReales` en `generarFormulario`), así que dejarlos declarados seguiría
-- bloqueando por un dato que el documento ya no imprime.
--
-- Qué entra como `optional: true`, y por qué:
--   · `numero_caso_upme` y `fecha_certificado` — los casos «solo IVA» se saltan la etapa
--     de Certificación. Medido el 2026-09-07 sobre los 401 negocios abiertos de SOENA:
--     283 tienen radicado y solo 96 tienen fecha del certificado. Exigirlos dejaría sin
--     documento a la mayoría. La cláusula SEGUNDO degrada por niveles (ver
--     `clausulaSegundo` en `src/lib/pdf/declaracion-juramentada-pdf.tsx`).
--   · Los campos del segundo titular — la copropiedad es la excepción (8 de 401).
--
-- Alcance medido ANTES de aplicar, sobre los 401 abiertos: pueden generar el PDF **282 hoy
-- y 307 con esta configuración**. Ganan 30 (casos sin certificado UPME, que hoy quedan
-- bloqueados por el `tipo_vehiculo` que salía del certificado) y pierden 5 (V0136, V0141,
-- V0181, V0200, V0412), a los que les falta el número de factura, el IVA o la fecha de
-- compra — datos que esta declaración afirma bajo juramento. Ese bloqueo es deliberado y
-- no es un callejón: el bloque es `editable_siempre`, así que el operador puede escribir
-- el valor en la casilla y el override satisface el faltante.

begin;

-- Respaldo de la configuración vigente. `bloque_configs` es catálogo, no datos de negocio,
-- pero un `config_extra` reescrito no se puede reconstruir desde ninguna otra parte.
-- server-only: respaldo de configuración; lo lee una persona por SQL si hay que revertir.
create table if not exists public.backup_declaracion_juramentada_20260907 as
select id, slug, config_extra, now() as respaldado_en
from public.bloque_configs
where id in (
  'f2878f39-5f3a-4067-abe2-3d15ba1a1c03',  -- declaracion_juramentada (Generación)
  '649b426c-01b8-4b56-8c13-b49100b01a75'   -- declaracion_juramentada_envio (Envío)
);

alter table public.backup_declaracion_juramentada_20260907 enable row level security;

do $$
declare
  v_campos jsonb := $json$[
    {"slug":"nombre_solicitante","source":{"tipo":"ai","campo_slug":"razon_social","bloque_slug":"rut","etapa_orden":6,"bloque_orden":2}},
    {"slug":"numero_identificacion","source":{"tipo":"ai","campo_slug":"numero_identificacion","bloque_slug":"rut","etapa_orden":6,"bloque_orden":2}},
    {"slug":"direccion","source":{"tipo":"ai","campo_slug":"direccion","bloque_slug":"rut","etapa_orden":6,"bloque_orden":2}},
    {"slug":"municipio","source":{"tipo":"ai","campo_slug":"municipio","bloque_slug":"rut","etapa_orden":6,"bloque_orden":2}},
    {"slug":"marca","source":{"tipo":"ai","campo_slug":"marca_certificado","bloque_slug":"concepto_upme","etapa_orden":9,"bloque_orden":1},"source_alternatives":[{"tipo":"ai","campo_slug":"marca","bloque_slug":"factura_venta_vehiculo","etapa_orden":1,"bloque_orden":1}]},
    {"slug":"linea","source":{"tipo":"ai","campo_slug":"linea_modelo_certificado","bloque_slug":"concepto_upme","etapa_orden":9,"bloque_orden":1},"source_alternatives":[{"tipo":"ai","campo_slug":"linea","bloque_slug":"factura_venta_vehiculo","etapa_orden":1,"bloque_orden":1}]},
    {"slug":"tipo_vehiculo","source":{"tipo":"ai","campo_slug":"tipo_vehiculo","bloque_slug":"factura_venta_vehiculo","etapa_orden":1,"bloque_orden":1}},
    {"slug":"fecha_factura","source":{"tipo":"ai","campo_slug":"fecha_factura","bloque_slug":"factura_venta_vehiculo","etapa_orden":1,"bloque_orden":1}},
    {"slug":"proveedor","source":{"tipo":"ai","campo_slug":"proveedor","bloque_slug":"factura_venta_vehiculo","etapa_orden":1,"bloque_orden":1}},
    {"slug":"numero_factura","source":{"tipo":"ai","campo_slug":"numero_factura","bloque_slug":"factura_venta_vehiculo","etapa_orden":1,"bloque_orden":1}},
    {"slug":"valor_unitario_sin_iva","source":{"tipo":"ai","campo_slug":"valor_unitario_sin_iva","bloque_slug":"factura_venta_vehiculo","etapa_orden":1,"bloque_orden":1}},
    {"slug":"valor_iva","source":{"tipo":"ai","campo_slug":"valor_iva","bloque_slug":"factura_venta_vehiculo","etapa_orden":1,"bloque_orden":1}},
    {"slug":"numero_caso_upme","optional":true,"source":{"tipo":"ai","campo_slug":"numero_caso_upme","bloque_slug":"concepto_upme","etapa_orden":9,"bloque_orden":1}},
    {"slug":"fecha_certificado","optional":true,"source":{"tipo":"ai","campo_slug":"fecha_certificado","bloque_slug":"concepto_upme","etapa_orden":9,"bloque_orden":1}},
    {"slug":"nombre_solicitante_2","optional":true,"source":{"tipo":"ai","campo_slug":"razon_social","bloque_slug":"rut_solicitante_2","etapa_orden":6,"bloque_orden":4}},
    {"slug":"numero_identificacion_2","optional":true,"source":{"tipo":"ai","campo_slug":"numero_identificacion","bloque_slug":"rut_solicitante_2","etapa_orden":6,"bloque_orden":4}},
    {"slug":"direccion_2","optional":true,"source":{"tipo":"ai","campo_slug":"direccion","bloque_slug":"rut_solicitante_2","etapa_orden":6,"bloque_orden":4}},
    {"slug":"municipio_2","optional":true,"source":{"tipo":"ai","campo_slug":"municipio","bloque_slug":"rut_solicitante_2","etapa_orden":6,"bloque_orden":4}}
  ]$json$::jsonb;
  v_filas int;
begin
  update public.bloque_configs
     set config_extra = jsonb_set(config_extra, '{campos_fuente}', v_campos, true)
   where id in (
     'f2878f39-5f3a-4067-abe2-3d15ba1a1c03',
     '649b426c-01b8-4b56-8c13-b49100b01a75'
   )
     and config_extra->>'template' = 'declaracion-juramentada';

  get diagnostics v_filas = row_count;

  -- Aborta si alguno de los dos bloques no existe o cambió de template: emitir el
  -- documento nuevo desde una sola de las dos etapas produce dos versiones del mismo papel.
  if v_filas <> 2 then
    raise exception 'Se esperaban 2 bloques con template declaracion-juramentada, se actualizaron %', v_filas;
  end if;
end $$;

commit;
