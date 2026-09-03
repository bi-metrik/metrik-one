---
name: plantilla-cotizacion-termotech
description: PR #522 — la plantilla visual por workspace reusa cotizacion_template_slug, no necesita migración de esquema; queda pendiente una sentencia de datos y la ficha del cliente está vacía
metadata:
  type: project
---

El PDF de cotización admite **una plantilla visual por workspace**, y la pregunta «qué
formato usa este cliente» la sigue respondiendo **una sola columna**:
`workspaces.cotizacion_template_slug`.

**Why:** esa columna ya existía desde 2026-05-15 apuntando a las plantillas HTML del
servicio externo `metrik-pdf-render`. Abrir una segunda columna para las plantillas
`@react-pdf` habría dejado dos fuentes para la misma pregunta, y ese desacuerdo es mudo:
el PDF sale con el formato de otro workspace y nadie ve un error. El registro de
`src/lib/pdf/plantillas-cotizacion.ts` decide el motor; un slug que no está ahí conserva
las ramas de antes, intactas.

**How to apply:**

- Para dar formato propio a un workspace nuevo: agregar el componente al registro y poner
  su slug en la columna. **No hace falta migración de esquema** — el mecanismo entero vive
  en código.
- El registro usa `Object.hasOwn`, no `PLANTILLAS[slug]`: sobre un objeto literal,
  `PLANTILLAS['constructor']` devuelve una función heredada del prototipo que acabaría en
  `createElement`. Lo encontró una prueba, no una revisión.
- Al ordenar el encendido: **deploy primero, sentencia de datos después**. Al revés, el
  motor le pide la plantilla al servicio externo, no la encuentra, y **cae al PDF genérico
  como si todo hubiera salido bien**.

## Estado al 2026-09-03 (PR #522 abierto, sin mergear, 5 checks verdes)

- ⚠️ **PENDIENTE DE APLICAR:** `proyectos/arca/one/migrations/2026-09-03_plantilla-cotizacion-termotech.sql`
  — una sola sentencia que pone el slug de `termotech`. Es lo único que enciende la
  plantilla; hasta que corra, Termotech ve el PDF genérico.
- `supabase/migrations/20260903140000_…` solo cambia el COMMENT de la columna. Inocua.
- La migración del PR #514 (`20260903100000`) **SÍ está aplicada, completa**: las tres
  columnas existen y el backfill corrió (28 ítems con `precio_manual = true`, **0 en
  riesgo**). ⚠️ Su encabezado sigue diciendo «ESTA MIGRACIÓN NO ESTÁ APLICADA» y eso
  puede llevar a re-aplicarla.

## Lo que el formato pide y el modelo no da (decisiones tomadas, no inventos)

- **Un solo capítulo**, titulado con `negocio.nombre`. En Termotech los negocios ya se
  llaman como capítulos («MANTENIMIENTO PREVENTIVO GENERAL»). No hay agrupación de ítems.
- **UND. = «Und» constante**: `items` no tiene unidad; la unidad vive en `rubros`, que es
  costo interno y no se le muestra al cliente.
- **La firma es quién APRETÓ GENERAR**, no quién elaboró la cotización: `cotizaciones` no
  tiene columna de autor. Con dos personas en el workspace, el nombre cambia según quién
  descargue. Decisión abierta.
- **Vigencia en días** derivada de `fecha_validez − fecha_envio`; si falta una fecha, la
  línea se omite en vez de inventar un default. El helper (`vigenciaEnDias`) lo comparte
  con el payload de WeasyPrint, que sí conserva su default histórico de 30 con `?? 30`.

## ⚠️ Huecos de DATOS que el código no puede tapar

- Las **dos empresas** del workspace `termotech` tienen `numero_documento` y
  `contacto_nombre` en **NULL**: en el PDF, «NIT» y «Atención a» salen con raya. El
  formato está bien; el dato no está.
- Las **3 cotizaciones** tienen `terminos_condiciones` vacío, así que la banda
  «CONDICIONES COMERCIALES» no aparece. El formato que espera el parser es un párrafo por
  línea con la forma `Rótulo: texto`.
- Ninguna cotización de **toda la base** pasa de **13 ítems**. Los 86 del brief son del PDF
  original de Termotech, no de datos de ONE: la paginación es preventiva.

Relacionado: [[mirar-pdf-renderizado]], [[medir-antes-de-construir]].
