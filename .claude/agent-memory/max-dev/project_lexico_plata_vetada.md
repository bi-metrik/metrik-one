---
name: lexico-plata-vetada
description: "Plata" está vetada en copy público desde 2026-04-21; el rótulo P1 ya dice "¿Cuánto efectivo tengo?" (#614), pero quedan ~20 apariciones visibles sin decidir y una de ellas es un IDENTIFICADOR persistido, no copy
metadata:
  type: project
---

**"Plata" es palabra vetada en copy público desde el 2026-04-21** (`cerebro/reglas/lexico-prohibido.md`)
y la pregunta canónica P1 es **"¿Cuánto efectivo tengo?"** (concordancia masculina: «cuán**to**»,
no «cuánta»).

**Why:** el rótulo viejo salía en la **captura del demo publicada en metrik.com.co**, o sea a la vista
de tráfico frío. Por eso el PR **#614** (mergeado 2026-09-10, `22f7055`) es de vitrina, no de higiene.

**How to apply:** el rótulo P1 ya está corregido en `/numeros` (tarjeta y drill-down), en story-mode y
en los cuatro comentarios que lo nombraban. `grep -rn "plata tengo" src/` da cero. **Lo que sigue
abierto es lo de abajo.**

## ⚠️ Quedan ~20 apariciones de «plata» en texto VISIBLE, y no todas son copy

El encargo del #614 acotaba el alcance a un rótulo, así que se auditaron y **no se tocaron**. Al
retomarlas, el orden importa porque son tres familias distintas:

1. **La hermana directa, cambio de una línea sin semántica:**
   `numeros-v2-client.tsx` (~línea 160), banner de alcance del modo Rentabilidad Comercial, **en la
   misma pantalla `/numeros`**: *«Las otras tres preguntas del negocio (cuánta plata tienes, cuánto te
   deben y cuánto aguantas)»*. Es P1 con otra redacción. Solo se ve con `rentabilidadComercialMode`
   (HJBC), por eso no es la de la captura.

2. **⚠️⚠️ Un valor persistido que PARECE copy: `'falta_plata'`.** Es una `CausaRetrocesoFinanciero`
   (`lib/negocios/retroceso-financiero.ts`, `recaudo-cambiado-banner.tsx`) que viaja a la base.
   Renombrarlo **es migración de datos**, no redacción. El `label` de al lado («Al negocio le falta
   plata») sí es copy. **Antes de un barrido de la palabra, separar identificadores de textos**: un
   `sed` sobre «plata» los toca a los dos y el segundo rompe filas históricas.

3. **Copy interno de operación, no vitrina** (conciliación/tesorería, tableros, y los mensajes de
   error de `lib/cobros/anulabilidad.ts`, `lib/cobros/redistribucion.ts`,
   `lib/actions/propuesta-economica-actions.ts`). Sustituir por «dinero» o «recaudo» **sí cambia el
   matiz** — lo que «entró» no es lo mismo que lo que se «reconoce» —, así que se decide en bloque y
   con Mateo, no de a una.

**Falsos positivos que inflan cualquier conteo de «plata»:** `plataforma`, `rol_plataforma`, los
municipios **La Plata** y **Gómez Plata** del catálogo DIVIPOLA, los `.test.ts` y los comentarios
JSX. Sin filtrarlos el grep da 433 y lo visible con sentido de dinero son ~20.

## Cómo se verificó el rótulo (sirve para cualquier cambio de copy en `/numeros`)

`QuestionCard` pinta `{title}` directo y `DrillDownSheet` pinta `{TITLES[questionNumber]}`: los dos
**renderizan en aislamiento** con `renderToStaticMarkup` sin doblar nada (`QuestionCard` no tiene un
solo hook; a `DrillDownSheet` le bastan cuatro props). El arnés fue **temporal y se borró**: una
prueba de copy se pudre con el copy. Se vio **fallar** devolviendo el mapa `TITLES` al valor viejo,
que es lo único que prueba que medía el rótulo y no otra cosa ([[pruebas-por-mutacion]]).

Relacionado: [[worktree-git-bloqueado]], [[probar-render-sin-dom]].
