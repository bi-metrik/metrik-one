---
name: cotizacion-margen-rubros
description: PR #514 — el ítem por rubros deja de quedar en cero; la migración NO está aplicada y su backfill decide si 11 ítems pierden $7,17M
metadata:
  type: project
---

**PR [#514](https://github.com/bi-metrik/metrik-one/pull/514) abierto, sin mergear, con los
5 checks obligatorios contados y en verde. La migración
`20260903100000_items_margen_precio_manual_y_terminos.sql` NO está aplicada.**

**Why:** Mauricio revisa antes de mergear, y el backfill de `precio_manual` es suyo.

**How to apply — lo que caduca y lo que no:**

⚠️ **El backfill comentado de esa migración no es opcional.** `precio_manual` nace en
`false` para todas las filas; el primer `recalcularTotales` reemplaza el precio que
alguien escribió por el costo pelado de sus rubros. Medido contra producción el
2026-09-03: **11 ítems, $7.173.361**. Solo 2 son alcanzables hoy desde el editor
($862.493, cotizaciones en borrador); los otros 9 están en aceptada/enviada/rechazada
— **pero `duplicarCotizacion` los copia a un borrador nuevo, y ahí sí**. Esa vía de
duplicación es lo que convierte "no editable" en alcanzable, y es lo que hace que el
backfill importe aunque el editor exija borrador.

**Las cifras se re-miden antes de decidir.** 37 ítems en toda la base al medirlas; un
cargue o una cotización nueva las mueve.

**Premisa del brief que resultó falsa y conviene no heredar:** el encargo entró como
"workspace Termotech, bloque de cotización", y **termotech tiene 12 ítems y ninguno usa
rubros**. Los 2 ítems con el defecto viven en `metrik` y `wmc-sm`. Para termotech el fix
es preventivo. Confirma [[medir-antes-de-construir]].

**Hallazgo lateral que cambió un diseño:** `cotizaciones.condiciones_pago` y
`cotizaciones.notas` **no las escribe nadie en la aplicación** — solo las lee el PDF.
El brief pedía poner el textarea de términos "junto a" ellas y no había tal sección.
Antes de ubicar un campo nuevo "al lado de" otro, comprobar que el otro tenga escritor.

**Lo que queda para el segundo encargo:** `cotizaciones.terminos_condiciones` ya viaja
tipado hasta `cotizacion-pdf-actions.ts` (`CotizacionNuevosCampos`) y nadie lo imprime.
El diseño del PDF se toca ahí.

Relacionado: [[medicion-sin-mcp-supabase]], [[pruebas-por-mutacion]].
