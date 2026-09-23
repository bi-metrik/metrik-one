---
name: titular-corregido-factura
description: "#833 (SIN mergear, sin migración): la financiera corrige nombre y documento del titular en «Revisar y facturar»; vive en metadata.titular_corregido y el PUT a Siigo se movió a DESPUÉS de resolver el tercero"
metadata:
  type: project
---

PR **[#833](https://github.com/bi-metrik/metrik-one/pull/833)**, rama `feat/titular-editable-factura-v0502`.
Brief: `proyectos/soena/ve/2026-09-22_brief-max-titular-editable-factura.md`. Mauricio confirmó
que factura, recibo RC-3 y abono RC-1 salen SIEMPRE al mismo tercero.

**Why:** cambiar el titular exigía volver a subir el RUT, y el reproceso borra datos
([[reproceso-documentos-migrados]]).

**How to apply:**
- La corrección vive en `negocios.metadata.titular_corregido` (`src/lib/siigo/titular.ts`), NO
  en el bloque RUT. `borradorCliente(rut, contacto, titular)` es la única puerta; todo documento
  pasa por `asegurarClienteSiigo`. Escribir lo mismo del RUT la quita (`null`).
- ⚠️⚠️ **El PUT al tercero va DESPUÉS de `asegurarClienteSiigo`**, nunca antes
  (`guardarCorreccionesDeFactura` → asegurar → `empujarCorreccionesAlTercero`). Antes salía contra
  el `siigo_id` de la marca, que con un titular corregido es el del titular ANTERIOR.
- El PUT solo reescribe un tercero que el RUT describe (mismo documento). Documento nuevo que ya
  existe en Siigo → se usa tal como está.
- Con factura emitida NO se corrige (el abono solo cruza contra la factura de su propio tercero).
- V0502 ya tenía FV-2-542 (John Jairo, 79782266): no es corregible, solo muestra titular y contacto.
- Abierto: el tercero NUEVO nace con dirección y ciudad del RUT cargado (puede ser de otra persona).

Relacionado: [[siigo-sucursal-adopcion]], [[factura-libre-abono]], [[pruebas-por-mutacion]].
