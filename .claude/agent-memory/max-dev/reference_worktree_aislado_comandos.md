---
name: worktree-aislado-comandos
description: En un worktree aislado, el guardia rechaza Bash con git dentro de heredocs, scripts bash, xargs o for; editar y mutar con python que no llama git
metadata:
  type: reference
---

El guardia del worktree aislado rechaza un Bash si no puede probar que no corre git: `bash script.sh`,
`xargs sh -c`, heredocs largos con `cat > ... <<EOF` mezclados con otros comandos, y `git` en un `for`.

- Ediciones a varios archivos: un `.py` en el scratchpad (Write) y `python3 archivo.py`.
- Pruebas por mutación: un `.py` que reemplaza, corre `npx vitest run` con subprocess y RESTAURA el texto original
  él mismo (sin `git checkout`). Luego `git status --short` aparte.
- `git` siempre como comando simple desde el worktree (`cd <worktree> && git ...`).
- `node_modules` del principal puede ir atrás (`unpdf`, `happy-dom`, `ai`): ver [[build-en-worktree]]. Para
  tsc + vitest limpios, `npm ci --no-audit --no-fund --ignore-scripts` DENTRO del worktree tarda ~15 s (25-oct)
  y evita falsos rojos; es gitignored, no hay que limpiarlo.
- `git worktree add` desde el repo principal lo rechaza el guardia (cambia de cwd al checkout compartido): si el
  brief pide «tu propio worktree», crear la rama en el worktree aislado propio (`git checkout -b <rama> origin/main`).
- También rechaza: rutas en variables de shell (`f=...; python3 ... $f`) y varios `npx` con rutas `(app)` encadenados con `;`/`echo $?`. Un comando por llamada, ruta literal entre comillas (25-oct).
