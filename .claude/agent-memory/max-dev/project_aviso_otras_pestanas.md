---
name: aviso-otras-pestanas
description: PR #611 (sin mergear) — el buscador de /negocios avisa cuando la coincidencia está fuera de la pestaña; por qué NO se ignora el chip de fase, y el hueco de `hayEnFaseEtapa` que el bloque cubre por su posición en el JSX
metadata:
  type: project
---

**PR [#611](https://github.com/bi-metrik/metrik-one/pull/611), rama
`feat/buscador-avisa-otras-pestanas`, base `6dc9792`. Mergeado: NO** — los 4 checks
obligatorios en verde, esperando decisión. Sin migración y sin una sola escritura a
producción.

**Why:** buscar el código exacto de un negocio cerrado con un chip de fase puesto
devolvía vacío, y el usuario lo lee como «el negocio no existe». Salió del QA del #610
con V0419 en soena. **Medido contra producción el 2026-09-10: los 48 cerrados de toda
la base (2 workspaces, 35 en soena) conservan un `stage_actual` que ningún chip de fase
muestra** — 43 de fase abierta y 5 con `'cerrado'`. No era un caso raro: les pasaba a
todos.

**How to apply:**

- **No se ignora el chip de fase cuando hay término, y eso fue decisión, no omisión.**
  La pestaña dejaría de significar lo que dice, y además rompería el contrato de la
  descarga a Excel, que baja exactamente los ids que la pantalla mostró. Si alguien
  vuelve a proponer «que la búsqueda ignore los filtros», esas son las dos razones.
- **El bloque del aviso va DESPUÉS del ternario lista/vacío, no dentro de la rama
  `sinResultadosBusqueda`.** Esa rama exige `hayEnFaseEtapa`, o sea que se apaga justo
  cuando la fase está vacía sin filtrar — el caso en que el aviso más hace falta.
  Meterlo dentro parece más ordenado y deja el hueco abierto; la prueba de render que
  lo fija cae 2 de 7 si alguien lo «arregla».
- **`faseCount` y `etapaCount` no se tocaron.** La regla «un contador no se filtra a sí
  mismo» (`segmentador.ts`) es otra cosa: el aviso no es un contador de fase.
- El helper puro es `src/lib/negocios/coincidencias-fuera.ts`. Recibe el universo, la
  lista visible y una función con los filtros **transversales**; ignora las tres
  dimensiones de pestaña (fase, etapa, motivo de cierre) y descuenta por id.

⚠️ **Lo que falta: QA en pantalla.** No se abrió la app. Todo fue medición contra
producción (lectura), render en aislamiento y verificación contra el CSS compilado.

⚠️ **Límite de las pruebas, declarado en el archivo:** la suite corre en `node`, sin
DOM, así que **el clic de «Ver en Todos» no se ejercita**. Lo que sí queda fijado es
que el botón se pinta y que el estado destino (`fase=todos`, sin etapa y sin motivo)
trae el caso. Si alguien borrara `setMotivoCierre('todos')` del handler, ninguna prueba
lo vería — es el hueco conocido.

Método: [[pruebas-por-mutacion]] con los seis conteos medidos y escritos en las
cabeceras de los dos archivos de prueba. Relacionado: [[todos-incluye-cerrados]],
[[cierre-desde-estado]], [[negocio-cerrado-solo-lectura]].
