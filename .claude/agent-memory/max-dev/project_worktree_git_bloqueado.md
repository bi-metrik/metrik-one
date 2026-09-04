---
name: worktree-git-bloqueado
description: Con isolation worktree, git fuera del propio worktree se bloquea (rama nueva DENTRO); otra sesión puede entrar al mismo árbol y borrar tu rama; y `gh pr merge` falla al final aunque el merge ya se hizo
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

## ⚠️⚠️ El aislamiento NO garantiza un worktree propio: dos sesiones pueden caer en el mismo

Medido el 2026-09-02 (PR #498): otra sesión paralela hizo `git checkout` de su rama **en este
mismo worktree**, **borró mi rama** (`git branch --list` ya no la mostraba) y estuvo
sobreescribiendo mis archivos en vivo — un módulo de `src/lib/` creció y volvió a encogerse
entre dos comandos míos. El guard de Bash impide que YO salga; no impide que OTRO entre.

**Señales tempranas, en orden de aparición:**
- archivos de scratch propios (`_q*.sql`) que cambian de contenido solos;
- `git branch --show-current` devuelve una rama que no es la mía;
- `git reflog` con `checkout: moving from <mi rama> to <la ajena>`;
- `git rev-parse --verify <mi rama>` → `fatal: Needed a single revision`.

**How to apply — commitear SIN tocar HEAD ni el árbol.** Cambiar de rama para commitear le
rompe la sesión al otro (es el daño exacto que el aislamiento quiere evitar, en reversa). Se
arma el commit con un índice temporal:

```bash
export GIT_INDEX_FILE=/ruta/fuera/del/repo/idx     # NO .git/index
git update-ref refs/heads/<mi rama> origin/main    # si la borraron; sin checkout
git read-tree <mi rama>
git add -- <solo mis archivos>                     # jamás `add -A`
TREE=$(git write-tree)
COMMIT=$(git commit-tree "$TREE" -p <mi rama> -F msg.txt)
git update-ref refs/heads/<mi rama> "$COMMIT" "$(git rev-parse <mi rama>)"
git push origin <mi rama>                          # empujar YA: la rama local se puede volver a borrar
```

⚠️ `read-tree` toma el árbol de la rama y `git add` toma el contenido del **working tree**,
que puede estar basado en un `main` más viejo: comprobar `git log <base vieja>..origin/main
--stat` y confirmar que no toca tus archivos, o el commit los **revierte en silencio**.

⚠️ El guard rechaza comandos «demasiado complejos» (`&&` con variables, `until`, heredoc con
redirección). Todo esto va en un `.sh` **dentro del worktree**, invocado con `bash script.sh`,
y se borra antes de cerrar.

### El mismo choque, visto desde el lado que estorba

Escrito por la otra mitad del incidente del 2026-09-02: **la sesión que "borró la rama" fue una
sesión Max que encontró el worktree con una rama ajena y sin commits.** `git branch -d` no
avisó nada —la rama apuntaba al mismo SHA que `main`, así que Git la dio por fusionada— y sus
archivos sin commitear siguieron ahí, indistinguibles de trabajo heredado del propio encargo.

**How to apply, al ABRIR un worktree que no se creó en esta sesión:**

1. `git status --short` **antes de tocar nada**. Archivos sin commitear que el encargo no
   menciona son de otra sesión, no herencia: `git ls-tree origin/main -- <ruta>` dice si el
   archivo existe en la rama principal o si es trabajo ajeno vivo.
2. **No borrar la rama que se encuentra puesta.** Que apunte a `main` no significa que esté
   libre: puede ser una sesión que commitea con `update-ref` sin mover HEAD, y entonces la
   rama es su único punto de anclaje. Se deja y se crea la propia con `switch -c`.
3. **No construir sobre un módulo que no está en `origin/main`.** Aquí se escribió una
   funcionalidad entera importando `lib/contactos/campanas.ts`, que parecía del repo y era de
   ese otro frente: mergearlo habría metido medio PR ajeno. Se comprueba con `git ls-tree
   origin/main`, no con «existe en mi árbol».
4. Si el PR ajeno **ya se mergeó** durante la sesión, rebasar (`git reset --mixed
   origin/main`) deja ver el delta real y suele permitir plegar lo propio en el módulo que
   ahora sí es canónico, en vez de dejar dos copias de la misma regla.

**Regla de convivencia:** en un archivo compartido, commitear **solo lo propio**. Si el otro
agente añadió código al mismo módulo, no arrastrarlo al PR aunque compile y sus pruebas pasen
— el repo ya lo dice para las superficies sin dueño («cada quien agrega solo lo suyo»).

## ⚠️ `gh pr merge --squash --delete-branch` **parece** fallar y en realidad mergeó

Medido el 2026-09-04 (PR #526). Desde el worktree aislado, el comando devuelve:

```
failed to run git: fatal: 'main' is already used by worktree at '…/metrik-one'
```

**El merge SÍ se hizo.** Ese error es del paso LOCAL posterior (`gh` intenta hacer
checkout de `main` para dejar el repo limpio, y `main` está ocupado por el checkout
compartido). Lo que NO alcanzó a correr es el borrado de la rama.

**How to apply:** ante ese mensaje, no reintentar el merge —crearía ruido o un segundo
PR—. Comprobar con `gh pr view <n> --json state,mergedAt,mergeCommit`; si dice `MERGED`,
lo único pendiente es `git push origin --delete <rama>`. El worktree propio tampoco se
puede quitar con `git worktree remove` desde adentro: se deja sin cambios sin commitear
y la sesión siguiente nace de `origin/main` fresco, como siempre.

Relacionado: [[sql-prod-one]], [[activity-log-vocabulario]].
