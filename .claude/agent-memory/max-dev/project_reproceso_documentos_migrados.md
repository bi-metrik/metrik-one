---
name: reproceso-documentos-migrados
description: PR #552 — el reproceso puede QUITAR datos y no es idempotente; `manual:true` es confianza baja, no edición humana; y los cinco casos de SOENA de los que solo uno se pudo reprocesar
metadata:
  type: project
---

PR **#552** mergeado (2026-09-07). Salió de un encargo que pedía «reprocesar la Factura
de V0136, V0141, V0181, V0200 y V0412». **Se reprocesó UNO.** El antes/después y el
porqué, en `proyectos/soena/ve/2026-09-07_reproceso-factura-5-casos.md`; respaldo de las
filas en `proyectos/soena/ve/qa/2026-09-07_respaldo-factura-5-casos.json`.

## ⚠️⚠️ El reproceso NO es idempotente: puede borrar datos buenos

Es lo único que hay que recordar de este frente. Volver a extraer el mismo archivo con el
mismo modelo da resultados distintos entre corridas, y un campo que baja de 0.70 de
confianza **se guarda como `null`**. Medido:

- **V0136** — `fecha_factura` pasó de `2024-10-04` (0.95) a `null` en 2 de 3 corridas, y
  el bloque cayó de `completo` a `pendiente`. Se corrió por error de secuencia y **se
  restauró desde el respaldo**.
- **V0200** — `nit_proveedor`: guardado `800100442`, corrida 1 `890442000`, corrida 2
  `830042000`. **Tres corridas, tres valores**, todos con confianza alta. Dato que va a
  la DIAN.

**How to apply:** antes de reprocesar en firme, **ensayar sin escribir** (bajar el
archivo y llamar `extractFieldsFromDocument`, las funciones reales) con **dos vueltas**, y
comparar campo a campo contra lo guardado. Se corre en firme solo donde gana y no pierde.
Un solo ensayo no basta: la inestabilidad es justo lo que hay que ver.

## ⚠️ `manual: true` NO es «editado a mano»

Es *confianza < 0.70 → valor forzado a null* (`extract-fields.ts`). El brief de este
frente lo leyó como campos que alguien había tocado, y de ahí salía la preocupación por
el merge de `reprocesarDocumento`. El merge está bien (solo conserva el campo manual **si
tiene valor**), pero **no había nada humano que proteger**: eran campos que la IA no supo
leer. Cambia la conclusión, no el código.

## ⚠️ `partida_arancelaria` = "0000" con confianza 1, inventado, en los cinco

El modelo lo fabrica siempre. Hoy no hace daño —se comprobó que **no es fuente de ninguna
casilla** de la declaración ni del 010 en la línea VE— pero queda escrito como dato duro y
vuelve `completo` un bloque por un valor falso. Si algún día alguien lo consume, esto
explota.

## La declaración juramentada no la bloquea `nit_proveedor`

Sus `campos_fuente` no lo incluyen. Al medir qué falta, preguntarle al resolvedor real
(`resolverFormularioParaEdicion`, que aplica `optional`, las alternativas y el umbral de
0.70), no razonar sobre la lista de campos extraídos.

⚠️ **Truco de medición reusable:** `resolverCamposFuente(supabase, negocioId, lineaId,
camposFuente)` resuelve **todo desde el `negocioId`** — el bloque solo aporta la config y
los overrides. Así que se puede anclar la config en el bloque de UN negocio que sí lo
tenga instanciado y variar el negocio, para saber qué le va a faltar a un caso que
todavía no llegó a esa etapa. Comprobar antes que el bloque ancla no tenga
`campos_override`.

Estado al cierre (solo V0412 puede generar): V0200 a una casilla (`numero_factura`),
V0136 a tres, V0141 a tres (es **proforma**, decisión 2026-09-03, no se completa a mano),
V0181 a cinco.

## Suelto que no se cerró

**La `fecha_factura` de V0200 dice `2020-02-21` para un modelo 2026, y el reproceso NO lo
corrige** (dos corridas, confianza 1, igual que lo guardado). El PDF es un **escaneo** sin
capa de texto, así que no se puede contrastar sin OCR ni mirándolo. Hay que verlo a ojo.

Relacionado: [[declaracion-juramentada-soena]], [[soena-ve-pipeline]],
[[medir-antes-de-construir]], [[cifras-del-brief-caducan]].
