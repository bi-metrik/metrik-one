---
name: probar-handler-wa-bot
description: Un handler del bot de WhatsApp NO se puede colectar desde vitest (wa-parse.ts lee Deno.env al importarse); la salida es extraer la decisión a un módulo puro, y así se comprueba en un comando
metadata:
  type: reference
---

**Ningún handler de `supabase/functions/_shared/handlers/` se puede probar con vitest.**
Comprobado el 2026-09-12 con una prueba sonda de dos líneas que importaba `resume.ts`:

```
ReferenceError: Deno is not defined
 ❯ supabase/functions/_shared/wa-parse.ts:9:22   const GEMINI_MODEL = Deno.env.get(...)
 ❯ supabase/functions/_shared/handlers/registro/gasto.ts:14:1
```

La cadena es `resume.ts` → `gasto.ts` → `wa-parse.ts`, que lee `Deno.env` **en el cuerpo del
módulo**, no dentro de una función. `vitest.config.ts` sí incluye
`supabase/functions/**/*.test.ts`, pero su propio comentario lo dice: «solo se recogen módulos
PUROS — los que tocan `Deno.env` o la red no se pueden colectar desde node».

**La sonda cuesta un minuto y evita media hora de escribir mocks que nunca van a correr:**
crear `<handler>.probe.test.ts` con un `import` del handler y un `expect(typeof fn)`, correr
`npx vitest run <ruta>`, borrarlo.

## La salida: la decisión sale a un módulo puro y el handler solo la ejecuta

Es lo que se hizo en el #658 con `handlers/registro/soporte-foto.ts`
(`decidirSoporte(entrada, reintentos) -> {accion, mensaje, ...}`). El handler queda en
«traducir el mensaje entrante a `EntradaSoporte`, pedir la decisión, ejecutarla». Así:

- la prueba ejercita el **routing**, que es donde vivía el defecto;
- se puede ver caer por mutación (aquí: devolver la rama `si` a `cerrar` puso **11 de 27** en
  rojo — [[pruebas-por-mutacion]]);
- no hace falta inventar un arnés de handlers, que es justo lo que el brief prohibía.

⚠️ **Una prueba del clasificador NO habría atrapado el bug.** `"Si"` se clasificaba bien; lo
que faltaba era la rama que hiciera algo con esa clasificación. La prueba tiene que ejercitar
la decisión completa, no la pieza de abajo.

## Los cuatro comandos que reproducen la CI de este repo

```
npx vitest run <archivos>                       # las pruebas del PR
find supabase/functions -name '*.ts' -not -name '*.test.ts' -print0 \
  | xargs -0 ~/.deno/bin/deno check --node-modules-dir=none   # «Tipos de edge functions»
node scripts/lint-lineas-cambiadas.mjs origin/main            # «Lint de lo que cambia» (DESPUÉS del commit)
npx tsc --noEmit ; npm run build
```

⚠️ `npm run lint` a secas da **52 problemas heredados** en este repo y no es el check de CI:
el que manda es `lint-lineas-cambiadas.mjs`, que separa la deuda vieja de las líneas del PR.
Y no ve lo que no está commiteado ([[worktree-git-bloqueado]]).
