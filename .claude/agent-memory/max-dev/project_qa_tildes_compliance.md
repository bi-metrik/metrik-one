---
name: qa-tildes-compliance
description: QA en pantalla del PR #613 — las tildes se ven bien y nada se rompió, pero quedaron 7 erratas en las mismas pantallas y el badge de clasificación muestra el valor crudo de la base
metadata:
  type: project
---

QA en pantalla del **PR #613** (mergeado, `f909442`), hecho el 2026-09-10 con el montaje de
[[capturas-ui-sin-servidor]] y datos ficticios. **Veredicto: quedó bien**, con tres cosas
abiertas que NO son daño del PR pero sí quedan a la vista por él.

**Why:** el riesgo real de un cambio de tildes es la codificación (que «Información» llegue
rota al navegador) y que una etiqueta que además es identidad rompa un guardado. Ninguna de
las dos ocurrió: 35 de 35 tildes se ven, cero mojibake, y elegir «Automático» / «Híbrido»
sigue guardando `automatico` / `hibrido` (comprobado moviendo el selector de verdad y leyendo
el payload, no leyendo el código).

**How to apply — lo que quedó abierto, por si alguien retoma el módulo:**

- ⚠️⚠️ **El badge de clasificación imprime el valor crudo de la base.** Tres sitios
  (`controles-list`, `control-detail-client`, `riesgo-detail`) pintan `{clasificacion}` con
  `class="capitalize"`, así que el **detalle dice «Automatico»** mientras el **formulario ya
  dice «Automático»**. Se ve de un vistazo en las capturas 02 y 03. No se puede arreglar
  tildando el `<option>`: o el badge pasa por un mapa de etiquetas, o el módulo convive con
  dos ortografías del mismo dato. **Decisión de producto, no la tomé.**
- ⚠️ **Quedan 7 erratas de acentuación en el copy de esas mismas pantallas**, medidas sobre el
  render: en `control-detail-client.tsx` — `Proximamente` (×3), `modulo`, `ejecucion` (×2),
  `automaticamente`, `recorrera`, `Veras` (todas dentro de los bloques «Próximamente»); y en
  `nueva-causa-form.tsx:234` la etiqueta **`Descripcion *`**, que es la más visible porque
  está 100 px debajo del título ya corregido «Descripción de la causa» (captura 05).
- ✅ **`revision` y `validacion` NO son valores almacenados**, contra lo que decía el encargo:
  son `key` de React del arreglo local `WORKFLOW_ETAPAS`, en un bloque «Próximamente», sin
  columna en `riesgos_controles` y sin ningún consumidor. Los únicos con dato detrás son
  `automatico` e `hibrido` (columna `clasificacion`). Detalle en [[cambio-solo-de-tildes]].

**Lo que se comprobó y salió limpio:** el filtro de categoría conserva `value="todos"`; los
mapas de impacto son `Record<number,…>` y se leen por número; la importación de Excel lee por
posición y saltea el encabezado; no existe ninguna comparación `=== '<etiqueta>'` en `src/`;
`tsc` limpio y las 3.681 pruebas del repo en verde.

Capturas (11 PNG, 1440 px) en
`proyectos/metrik/one/qa/2026-09-10_tildes-compliance/`. Las 8 mutaciones del arnés cayeron
todas ([[pruebas-por-mutacion]]), incluidas las dos que mueven la identidad (`value` acentuado),
que son las que habrían roto el guardado.

Relacionado: [[capturas-sustenta-landing]].
