---
name: techo-postgrest-1000-filas
description: PostgREST recorta en 1.000 filas sin avisar; el helper `traerTodo` es la única vía para lecturas por lote, y cuáles filas se pierden depende del plan (no es reproducible)
metadata:
  type: project
---

Toda lectura por LOTE en ONE va por `traerTodo` (`src/lib/supabase/paginar.ts`), con
un `.order('id')` estable en la página. PR #491, mergeado 2026-09-02 (`1fe8fd4`).

**Why:** PostgREST corta cualquier respuesta en **1.000 filas** devolviendo 200 y sin
`error`. Quien lee no puede distinguir «no hay más» de «hay más y no te las mandé».
En la cola de facturación de SOENA eso significaba: consulta que pedía 1.115 filas,
48 casos mostrados sin identificación/nombre/ciudad/dirección/correo teniéndolo todo
guardado, y **dos casos ya facturados (V0089, V0428) devueltos a la bandeja como
facturables** — V0428 marcado listo para emitir.

**Lo que más cuesta ver, y por eso está aquí:** **cuáles filas se pierden depende del
plan de la consulta y cambia entre corridas.** Dos mediciones separadas por minutos
dieron 24 y 23 casos sin servicio declarado; y mi emulación en SQL (`row_number()
over ()`) cortaba un conjunto distinto del que cortaba PostgREST en vivo. O sea:
**el síntoma no es reproducible y no sirve para acotar el alcance.** Hay que medir el
conteo de filas de la consulta, no la lista de víctimas.

**How to apply:**
- Antes de escribir, contar las filas que pide la consulta (`select count(*)` con los
  mismos filtros). Si se acerca a 1.000, ya está roto o lo estará.
- El tamaño de página se acota a 1.000: pedir 5.000 devuelve 1.000 y un `<` ingenuo
  lo lee como «se acabó». Es la forma de reintroducir el bug.
- Un lote que cae **justo** en el límite pide la página siguiente. Solo una página
  corta cierra el recorrido.
- Sin `.order()` estable, la página 2 no continúa donde terminó la 1: se repiten
  filas y se pierden otras. Mismo fallo mudo, otro disfraz.
- Quien llama envuelve en `try/catch` y devuelve error: una bandeja que no se pudo
  armar **dice que falló**, no se degrada a bandeja corta.

**Bounded y medido (2026-09-02), no hace falta paginar:** lecturas por UN negocio
(máximo real 13 cobros, 120 bloques) y por línea (143 `bloque_configs`). No crecen
con el número de casos abiertos.

⚠️ **Hueco abierto del mismo género, otra fuente:** el catálogo de Siigo se pide con
`page_size=100` sin paginar, y sirve tanto para mostrar conceptos como para
**validar** el que llega de la pantalla. Con más de 100 productos, un concepto
legítimo se rechazaría. No se tocó: cambiar el patrón de peticiones a Siigo tiene
implicaciones de límite de tasa ya documentadas en `CLAUDE.md`.

Relacionado: [[medir-antes-de-construir]], [[sql-prod-one]],
[[medicion-cola-facturacion-con-vitest]].
