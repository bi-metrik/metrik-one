---
name: squash-wip-contra-sha-fijo
description: Para aplastar commits WIP nunca `git reset --soft origin/main` a secas: otra sesion mueve origin/main y el commit REVIERTE lo ajeno
metadata:
  type: feedback
---

Aplastar los WIP con `git reset --soft $(git merge-base HEAD origin/main)`, nunca con
`git reset --soft origin/main` a secas.

**Why:** 2026-09-30, fix del flujo guiado del gasto: entre mi `fetch` inicial y el squash, otra
sesion (los worktrees comparten `.git`) hizo fetch y `origin/main` avanzo a #964. El reset --soft
movio HEAD al main nuevo con MI arbol viejo en el indice: el commit borraba todo #964 (migracion,
modulos, pruebas) y alcance a hacer push de la rama. Se vio en `git status` (archivos D/M ajenos)
y se rehizo con `reset --hard` al main nuevo + `git apply -3` del diff propio antes de abrir PR.

**How to apply:** squash contra el merge-base; y ANTES de cada commit/push de squash, mirar
`git status --short`: si aparece un archivo que no toque, parar.
Relacionado: [[worktree-git-bloqueado]], [[rebase-pr-ajeno-mirar-reflog]].
