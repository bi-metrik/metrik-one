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

⚠️ **Limpiar antes de commitear.** `node_modules` está ignorado, así que no ensucia el commit,
pero dejarlo colgando de `/tmp` deja una prueba que pasa hoy y falla mañana sin explicación.

Relacionado: [[ensayo-sql-pglite]], [[arbol-limpio-por-tarball]].
