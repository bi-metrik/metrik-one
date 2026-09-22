---
name: rebase-pr-ajeno-mirar-reflog
description: Antes de rebasar y hacer force-push a la rama de un PR de OTRA sesión, mirar el reflog de esa rama local (el .git es compartido); la sesión dueña puede estar rebasando en ese mismo minuto
metadata:
  type: feedback
---

Antes de rebasar y hacer `push --force-with-lease` sobre la rama de un PR que abrió otra
sesión, mirar **dos cosas** desde el worktree propio:

1. `git worktree list`: dice qué worktree tiene la rama abierta.
2. `git reflog show --date=iso <rama>`: la rama local es compartida (un solo `.git`), así
   que su reflog muestra rebases y commits de la otra sesión **aunque todavía no los haya
   subido**. `origin/<rama>` no los ve.

**Why:** el 2026-09-22 el coordinador pidió rebasar el #826 «en un worktree propio». El
remoto seguía en el commit viejo, pero el reflog mostraba que la sesión dueña lo había
rebasado 3 minutos antes, y otra vez sobre el main nuevo mientras yo corría las pruebas,
con un commit de más. Mi push habría pisado un superconjunto de mi propio trabajo. No se
empujó nada.

**How to apply:**
- Si el reflog tiene actividad reciente que no está en `origin`, **no empujar**: reportar
  al coordinador quién tiene la rama y desde cuándo.
- La resolución propia sirve igual como control: `git diff <mi-rebase> <su-rama-local>`
  debe dar solo lo que la otra sesión añadió después.
- `--force-with-lease` con el SHA del remoto protege el remoto, **no** el trabajo local de
  la otra sesión: su push posterior falla y queda a ella reconciliar.

Relacionado: [[worktree-git-bloqueado]].
