---
name: descarga-excel-negocios
description: PR #525 (2026-09-03) — descarga a Excel de /negocios; por qué «Recaudado honorario» sale de los tramos BRUTOS de v_cobro_valor y no de v_venta_mes_comercial, qué punteros del spec estaban caducos, y qué quedó sin QA
metadata:
  type: project
---

La descarga a Excel de `/negocios` (Acta SOENA, SEXTA num. 2) entró con el **PR #525**:
`POST /api/negocios/export {ids}` + módulo puro `src/lib/negocios/export-excel.ts` + botón
para owner/admin/supervisor (`puedeDescargarNegocios` en `roles.ts`, fuente única).

**«Recaudado honorario» sale de `v_cobro_valor.a_tramo1 + a_tramo2` (BRUTO, con IVA), no
de `v_venta_mes_comercial.honorario_recaudado`.** El spec (escrito el 2026-09-03) apuntaba
a la vista, pero esa columna **bajó a base (sin IVA) el 2026-09-02** (`20260902220053`), y
el respaldo que el spec nombraba, `v_cobro_valor.propio_con_iva`, **no existe desde el
2026-08-11** (se renombró a `a_tramo1`). Seguirlo al pie restaba un recaudado sin IVA de un
honorario con IVA, que es lo que el propio spec prohibía.

**Why:** un spec escribe punteros a columnas el día que se redacta, y en este repo las
vistas del dinero se reescriben cada pocos días desde varias sesiones. Los punteros
caducan igual que las cifras ([[cifras-del-brief-caducan]]).

**How to apply:** antes de consumir una columna de una vista nombrada en un brief, buscar
la ÚLTIMA migración que la define (`grep -in "view public\.<vista>\|view <vista>"
supabase/migrations/*.sql`, y leer la más nueva, no la primera) y comprobar el nombre y la
semántica (bruto vs base). Regla de este producto: **tableros = `_base` (ingreso); caja,
cartera, saldos y lo que se le muestra al cliente = bruto (lo que entró a la cuenta)**.
`a_tarifa` no tiene base a propósito (la tarifa UPME no causa IVA).

Otras decisiones del PR que no se deducen del código:

- La ruta lee `getNegociosV2('abierto')` + `('completado')` y se queda con los ids que
  manda el cliente **en ese orden**: es lo que hace WYSIWYG sin reimplementar
  `aplicarFiltros`. Los pausados no salen porque la lista tampoco los muestra.
- Los cobros SIN fecha (programados de un plan) entran como «pago» porque el spec definió
  pagos como `anulado_at is null` a secas; van de últimos. Hoy no aplica a SOENA (sin
  planes). Si un workspace con planes exporta, ese es el primer ajuste que va a pedir.
- CI lintea **solo las líneas del PR** (`Lint de lo que cambia`); `npm run lint` completo
  trae 46 errores preexistentes (react-hooks y `no-explicit-any` en `supabase/functions/`).
  No se arreglan en un PR ajeno a ellos; el brief que pida «lint en verde» se lee así.

**Sin QA en pantalla:** nadie descargó el archivo desde el preview. Pasos en el cuerpo del
PR (login supervisor en soena, `?fase=venta`, contar filas contra el chip). Pasivo de QA
de Mauricio.

Relacionado: [[sheetjs-fechas-excel]], [[techo-postgrest-1000-filas]], [[tableros-soena]].
