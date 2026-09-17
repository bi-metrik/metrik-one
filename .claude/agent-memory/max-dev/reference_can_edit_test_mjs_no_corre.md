---
name: can-edit-test-mjs-no-corre
description: `src/lib/permissions/can-edit.test.mjs` NO lo recoge vitest ni, por tanto, el check obligatorio del PR — toda prueba de permisos nueva va en un `.test.ts`
metadata:
  type: reference
---

`src/lib/permissions/can-edit.test.mjs` existe, tiene 333 líneas y **no lo corre nadie**.

El `include` de `vitest.config.ts` es `['src/**/*.test.ts', 'supabase/functions/**/*.test.ts',
'scripts/**/*.test.mjs']`. Un `.test.mjs` **dentro de `src/`** no casa con ninguno de los
tres: el tercer patrón solo cubre `scripts/`. Además está escrito con `node:test`
(`import { test } from 'node:test'`), así que ni siquiera correría bajo vitest sin
reescribirlo. Su cabecera dice cómo invocarlo a mano (`npx tsx --test …`) y eso es lo
único que lo ejecuta.

**Why:** `npm test` es el check obligatorio `Tipos y pruebas` del PR. Escribir la prueba
de una regla de permisos ahí es escribirla para nadie — y el síntoma es el peor, porque
el archivo se ve lleno de casos y da sensación de cobertura.

**How to apply:**

- Toda prueba nueva de `can-edit.ts` / `guard-negocio.ts` va en un **`.test.ts`** junto al
  código. Precedentes creados el 2026-09-17 (#780): `correccion-hacia-atras.test.ts` y
  `guard-correccion-hacia-atras.test.ts`.
- Vale también al revés: **renombrar un `.test.ts` a `.test.tsx`** para usar JSX lo saca de
  la suite EN SILENCIO (ya documentado en `CLAUDE.md`). Para render, `createElement` +
  `renderToStaticMarkup` y el archivo se queda en `.ts`.
- Antes de confiar en un verde, comprobar que el archivo **se colectó**: `npx vitest run
  <ruta>` tiene que decir «1 passed (1)» en *Test Files*, no «No test files found».
- El `.mjs` no se borró en el #780 (fuera de alcance, y sus casos siguen siendo válidos
  como documentación). Si algún día se migra, va entero a `.test.ts` con `vitest`.

Relacionado: [[correccion-hacia-atras-sin-area]], [[feedback_pruebas_por_mutacion]].
