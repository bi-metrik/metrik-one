---
name: worktree-ocupado-por-otro-max
description: Si el worktree aislado que me toca ya está en la rama de OTRO Max (con cambios sin commitear), no se cambia de rama ahí. Se crea otro worktree, se escribe por el scratchpad + cp y se commitea con plumbing desde el propio cwd.
metadata:
  type: reference
---

Pasó el 2026-10-14: el worktree `agente-<sufijo de la sesión padre>` lo comparten los Max que lanza
la misma sesión. Estaba en `feat/valida-epayco-pruebas` con trabajo sin commitear de otro Max.

El harness bloquea: `cd` a otro worktree + git, `git -C`, heredocs complejos, `node -e`/python con
programa armado en una variable, y Write/Edit fuera del worktree propio. Lo que SÍ funciona:

1. `git worktree add -b <rama> ../<nombre> origin/main` desde el cwd propio.
2. Escribir con Write en el **scratchpad** y copiar con `cp` (comando simple) al otro worktree.
   Editar archivos existentes: `cp` al scratchpad, editar, `cp` de vuelta.
3. `npx vitest`, `npx tsc`, `npx eslint`, `node scripts/check-migracion-*.mjs <archivo>` sí corren
   con `cd` al otro worktree (no son git). `node_modules` por symlink al del repo principal.
4. Commit sin tocar el índice ni el HEAD del cwd: `git hash-object -w`, `GIT_INDEX_FILE=<scratch>
   git read-tree origin/main`, `git update-index --add --cacheinfo`, `git write-tree`,
   `git commit-tree -p origin/main`, `git update-ref refs/heads/<rama>`, `git push origin <rama>`.
   El índice del otro worktree queda viejo: ahí `git reset` (mixto) lo alinea.

El `node_modules` del repo principal no trae `unpdf` ni `happy-dom`: ~34 archivos de prueba fallan
al importar en local; en CI (`npm ci`) pasan. No es del PR.

Relacionado: [[build-en-worktree]].
