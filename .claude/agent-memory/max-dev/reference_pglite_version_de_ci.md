---
name: pglite-version-de-ci
description: Cómo correr una migración de metrik-one con PGlite desde un worktree aislado, con la versión exacta que usa CI y sin tocar el node_modules compartido
metadata:
  type: reference
---

`@electric-sql/pglite` **está en `package.json` de `origin/main` pero NO en el `node_modules`
de la torre** (medido el 2026-09-16: `metrik-one/node_modules/@electric-sql` no existe). O sea
que `src/lib/retencion-bot/purga-sql.test.ts` y cualquier prueba de migración **no corren en
local** tal cual, aunque en CI sí.

**Cómo correrlas sin tocar el árbol compartido:**

```bash
# 1. instalar en el scratchpad, con la version EXACTA de package.json
mkdir -p <scratchpad>/pglite && cd <scratchpad>/pglite
npm install --silent --no-audit --no-fund @electric-sql/pglite@<version de package.json>

# 2. colgarlo SOLO a el del node_modules del worktree
cd <worktree>
mkdir -p node_modules/@electric-sql
ln -sfn <scratchpad>/pglite/node_modules/@electric-sql/pglite node_modules/@electric-sql/pglite

# 3. al terminar
rm -rf node_modules/@electric-sql && rmdir node_modules 2>/dev/null
```

**Por qué solo ese paquete:** Node recorre los `node_modules` hacia arriba, y el worktree cuelga
de `metrik-one/`, así que todo lo demás se resuelve solo. **No hace falta symlinkear
`node_modules` entero**, y hacerlo es peor: si ya existe un `node_modules/` con la caché de
`.vite`, un `ln -sfn` crea `node_modules/node_modules`, que es el gotcha que rompe builds.

⚠️ **La versión importa y hay que leerla de `package.json`, no elegirla.** Se probó primero con
`^0.3.0` y todo pasó; CI usa **0.5.8**. Un verde contra otra versión mayor no dice nada del
verde de CI. Comprobar con `git show origin/main:package.json | grep pglite`.

⚠️ **Si el `node_modules` del worktree YA es un symlink al del repo principal, esa receta no
sirve**: colgarle `@electric-sql` adentro escribe en el `node_modules` compartido. La variante
que funcionó (2026-09-22, PR #814) es **no tocar `node_modules` y aliasar**: un
`vitest.pglite.config.ts` **temporal** en el worktree, copia del `vitest.config.ts` del repo
más una línea en `resolve.alias`:

```ts
'@electric-sql/pglite': '<scratchpad>/node_modules/@electric-sql/pglite/dist/index.js',
```

y correr `npx vitest run --config vitest.pglite.config.ts <archivo>`. **Borrar el config antes
de commitear** (no está en `.gitignore`). Ventaja: no deja nada dentro de `node_modules` y
sirve igual para la suite completa.

⚠️ **`tsc --noEmit` va a marcar el archivo en local y está bien:** sin los tipos del paquete,
`TS2307` más un `TS7006` por cada `row =>` del test. Los tres tests de migración que ya están
en `main` tienen exactamente los mismos errores en la torre y CI los da en verde — o sea que
esos errores **no** son señal de que el test esté mal.

⚠️ **Limpiar antes de commitear.** `node_modules` está ignorado, así que no ensucia el commit,
pero dejarlo colgando de `/tmp` deja una prueba que pasa hoy y falla mañana sin explicación.

Relacionado: [[ensayo-sql-pglite]], [[arbol-limpio-por-tarball]].
