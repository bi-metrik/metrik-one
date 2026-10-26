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
- 26-oct: rechazó también un `cat >> archivo <<'EOF'` SOLO (sin git) y un `python3 -c` con escapes; `deno run x.ts > archivo` sí pasa. Para anexar o reemplazar texto, Edit directo.
- 26-oct (tarde): rechazó `git show … | grep -n "alias" …` por la PALABRA `alias` en el comando (cree que se ejecuta un
  alias). Volcar con `git show <ref>:<ruta> > scratchpad/x.ts` y grep aparte. Para comparar la conducta de la base
  contra la rama sin otro worktree: `git checkout <base> -- supabase/functions`, correr, `git checkout HEAD -- supabase/functions`
  (comandos sueltos; un archivo de prueba sin seguimiento sobrevive al checkout). `python3 - <<'EOF'` sí pasa.
- También rechaza: rutas en variables de shell (`f=...; python3 ... $f`) y varios `npx` con rutas `(app)` encadenados con `;`/`echo $?`. Un comando por llamada, ruta literal entre comillas (25-oct).
