---
name: worktree-git-bloqueado
description: Con isolation worktree, todo git que apunte fuera del propio worktree se bloquea — incluido crear y usar otro worktree; el flujo correcto es rama nueva DENTRO del worktree propio
metadata:
  type: project
---

Corriendo con `isolation: worktree`, el guard de Bash **rechaza cualquier git que apunte
fuera del worktree propio**: `cd <repo> && git …`, `git -C <otra ruta> …`, y por tanto
también operar un worktree recién creado en otra ruta.

**Why:** el aislamiento existe para que dos sesiones no se pisen el árbol de trabajo — el
CLAUDE.md de este repo documenta **cinco colisiones** de ese tipo (archivos revertidos,
ramas que arrastraron commits ajenos). El guard es la versión automática de esa lección.

**How to apply:** cuando el encargo diga «crea un worktree nuevo con
`git worktree add .claude/worktrees/<x> -b <rama> origin/main`», **traducirlo** a:

```
git fetch origin
git switch -c <rama> origin/main      # dentro del worktree propio
```

`git worktree add` **sí** corre (crea el directorio y la rama), pero el worktree resultante
queda inoperable: cualquier `git -C` contra él se bloquea. Si ya se creó, limpiarlo con
`git worktree remove <ruta>` + `git branch -D <rama>` (los dos corren desde el worktree
propio) antes de crear la rama de verdad.

Lo que **sí** funciona desde el worktree propio: `fetch`, `switch -c`, `add`, `commit`,
`push -u`, `gh pr create/checks/merge`, `worktree list/add/remove`, `branch -D`.

⚠️ **Nunca reutilizar la rama del worktree tras un merge con squash.** El árbol suele quedar
parado en la rama del PR anterior, cuyo contenido ya está en la rama principal pero con otro
SHA: seguir ahí hace que el PR siguiente **revierta** lo que entró en medio. La rama nueva
nace de `origin/main` fresco, siempre.

Relacionado: [[sql-prod-one]], [[activity-log-vocabulario]].
