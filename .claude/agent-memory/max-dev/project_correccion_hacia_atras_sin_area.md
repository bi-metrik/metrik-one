---
name: correccion-hacia-atras-sin-area
description: PR #780 mergeado — el área deja de cortar la corrección de bloques de etapas superadas para owner/admin/supervisor; el opt-in del bloque es la única válvula y SOLO SOENA lo declara
metadata:
  type: project
---

El área dueña de un bloque sale del stage de su etapa. Desde el **PR #780** (squash
`6847de74`, mergeado y verificado contra `origin/main` el 2026-09-17, sin migración),
ese chequeo **se omite** cuando la escritura cae sobre un bloque de una etapa que el
negocio YA superó y el rol está en `ROLES_CORRECCION_DOCUMENTOS`.

**Why:** una supervisora de `operaciones` (Deisy, SOENA) no podía corregir nada de
`venta` ni `cobro` — 68 de los 113 bloques `datos`/`documento` de su línea — y su única
salida era Devolver el documento a quien lo cargó.

**How to apply:**

- **La regla es `corrigeHaciaAtrasSinArea(user, { esPostAvance })`** en
  `src/lib/permissions/can-edit.ts`, con `esEtapaSuperada(ordenBloque, ordenActual)` al
  lado. Fuente única: la consumen `guardEditarBloque` y el `_areaReadonly` que arma
  `getNegocioDetalleCompleto`. **No reescribirla en un `if`**: la contradicción
  pantalla-vs-servidor es justo lo que este frente cerró.
- ⚠️ **El opt-in `corregir_campos_gerencial` del bloque es la ÚNICA válvula real**, y lo
  exige `actualizarBloqueData`, no el guard. Medido el 2026-09-17 sobre los **327
  `bloque_configs` de toda la base**: los 53 que lo declaran son **todos de SOENA**. Si
  alguien pregunta por qué en otro workspace "no pasa nada", es esto.
- ⚠️ **`canAdvanceStage` NO lo pasa nunca** (probado). Corregir un dato de una etapa
  pasada no es mover el negocio; para avanzar una etapa ajena sigue estando
  `areas_que_avanzan`.
- ⚠️ **`operator` no gana nada**: no está en `ROLES_CORRECCION_DOCUMENTOS`. Y el guard lo
  descarta **sin IO** — la consulta extra del `esPostAvance` solo se paga cuando el
  chequeo de área falló y el rol sí corrige.
- **El historial NO recibía `_areaReadonly` en absoluto** (solo lo tenían los bloques de
  la etapa actual, y medido contra `stage_actual`). Ahora se calcula **por bloque**
  contra el stage de SU etapa. Para la etapa actual el valor es idéntico al de antes.
- **`BloqueDocumento` ya respeta `_areaReadonly`** en `puedeCorregirVisible`, como
  `BloqueDatos`. Antes lo ignoraba y ofrecía el campo siempre.

## Reemplazar el archivo, no solo sus campos

Botón **Reemplazar archivo** en modo `visible`, con las mismas tres llaves que corregir
un campo (opt-in + rol/responsable + causa elegida) y el **mismo `sesionDoc`**: reemplazo
y campos en un acto son UNA corrección. Slug del registro: `archivo`.

⚠️ **El servidor lo exige en `procesarDocumento` vía
`src/lib/documentos/reemplazo-hacia-atras.ts`, y el criterio tiene dos carve-outs que NO
se pueden quitar:**

- **bloque vacío** en etapa pasada = primera carga, sin causa. Sostiene los bloques que
  se **reactivan tarde** (`rut_solicitante_2`) — son vacíos por definición.
- **`editable_siempre`** queda fuera **aunque ya tenga archivo**: ese flag declara el
  bloque abierto siempre (la factura que baja de Siigo después). 25 bloques lo declaran,
  todos en SOENA.

Sin esos dos, el gate rompería justo los mecanismos que existen para el caso contrario.
Lo que NO es reemplazo: `editable_siempre` **no** sirve para corregir hacia atrás (deja
el bloque abierto desde todas partes), y por eso se construyó la puerta con causa.

## Lo que NO se abrió

Los bloques de plata: **ninguno declara `corregir_campos_gerencial`** (medido sobre los 9
con banderas de plata). `Pago externo` y `Conciliación` van por
`puedeGestionarPagosExternos` (`ctx-pagos-externos.ts`) y ePayco por `registrarPagoEpayco`,
que **no pasa por `guardEditarBloque` en absoluto**. `es_multi_pago` no tiene ni una
instancia en producción.

## Suelto, sin cerrar

Un bloque que se **reactiva tarde** y **no** declara `corregir_campos_gerencial` no lo
puede llenar nadie: el guard deja pasar y `actualizarBloqueData` rechaza por el opt-in.
Es pre-existente; en SOENA no muerde porque el caso canónico sí lo declara.

Relacionado: [[guard-bloque-items]], [[omitir-gate-por-persona]], [[sprint-10 supervisor y contador]].
