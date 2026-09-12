---
name: nombre-cotizacion-variantes
description: PR #668 mergeado — el nombre de la variante vive en `cotizaciones.descripcion` (columna vieja que nadie escribía); el `??` del fallback no atrapaba la cadena vacía y falta QA en pantalla
metadata:
  type: project
---

**PR [#668](https://github.com/bi-metrik/metrik-one/pull/668) mergeado el 2026-09-12, sin
migración y sin escrituras a producción.** Las variantes de un viaje ("España 7 días" vs
"Portugal 5 días") son cotizaciones del MISMO negocio; lo que faltaba no era el modelo,
era poder distinguirlas en la lista.

**Why:** `cotizaciones.descripcion` existía desde siempre, la lista ya la pintaba, y **no
la escribía nadie**. Medido antes de tocar código: **0 de 18 cotizaciones en toda la base**
tenían nombre, así que todas mostraban la etiqueta genérica de su modo y las 2 ya
duplicadas eran indistinguibles de su original.

**How to apply:**

⚠️ **El `??` de un fallback NO atrapa la cadena vacía, y el vacío llega de DOS formas**:
`null` de la base y `''` de un campo que alguien borró. `BloqueCotizacion` resolvía con
`cot.descripcion ?? (etiqueta genérica)`, así que un nombre borrado dejaba la fila como
`COT-2026-0003 · ` — sin nada que la identifique, **peor que la etiqueta genérica que
venía a reemplazar**. Se cierra por los dos lados: el editor guarda `null` y nunca `''`,
y `nombreMostrable` normaliza al leer. Familia de los fallos mudos de este repo: la
pantalla no falla, solo deja de decir.

⚠️ **Una prueba pura NO fija que el JSX use el helper.** `nombreMostrable` puede estar
perfecto y la línea seguir con el `??`: las dos salen verdes. Solo la prueba de render
(`renderToStaticMarkup`, en `.ts` porque el `include` de vitest es `src/**/*.test.ts`) mata
esa mutación — **se vio caer 3 de 6** devolviendo la línea a su forma anterior. Mismo
precedente que `recaudo-cambiado-banner.test.ts` y el botón de facturar del #581.

**Las DOS rutas de duplicación comparten la regla** (`src/lib/cotizaciones/nombre-cotizacion.ts`,
pura): `duplicarCotizacion` (cotizacion-actions, sirve negocio **y** oportunidad) y
`duplicarCotizacionNegocio` ([id]/cotizacion/actions, solo negocio). Escrita dos veces se
desincroniza y el síntoma sería que duplicar desde una pantalla numera distinto que desde
la otra.

**Tres decisiones del nombrado que no se revierten sin pensarlo:**
- **Original sin nombre → copia sin nombre.** No se inventa una etiqueta donde no había:
  dejar una fila muda y otra nombrada es peor que el problema de partida.
- **No encadena sufijos:** `España (2)` propone `(3)`, no `(2) (2)`.
- **Tope de 99 al contador**, para que un paréntesis que es parte del nombre no se lo coma
  la regla: `Modelo 500 (2024)` conserva el año. Sin el tope, la propuesta borra información
  del nombre.

⚠️ **Queda sin QA en pantalla.** No se abrió el editor ni la lista en el navegador. Lo que
está fijado por pruebas es el render de la lista y la regla de nombrado; el guardado al
salir del campo sigue el patrón del resto del editor pero no se ejercitó contra la base.

**No se tocó** el motor de precio ni `convencion_margen`/`margen_default_pct` (congelados
por decisión del 2026-09-11).

Relacionado: [[cotizacion-margen-rubros]], [[pruebas-por-mutacion]], [[medir-antes-de-construir]].
