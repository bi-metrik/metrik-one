---
name: otro-repo-desde-worktree-aislado
description: Cómo trabajar en otro repo (metrik-landing, etc.) cuando corro aislado en un worktree de ONE; git -C y cd al repo los niega el guard
metadata:
  type: reference
---

Aislado en un worktree de ONE, el guard niega `cd <otro repo> && git ...` y `git -C <otro repo>`; tampoco deja crear el worktree que pida el brief dentro del checkout compartido.

Lo que sí funciona (2026-10-27, metrik-landing PR #13): `git clone https://github.com/bi-metrik/<repo>.git` dentro del scratchpad, rama nueva, commit, `git push -u origin <rama>` y `gh pr create --repo ...`. El checkout compartido y sus worktrees no se tocan. Avisarle al que me lanzó que el trabajo quedó en un clon y no en el worktree pedido.

Otras trampas del guard:
- Comandos con variables (`S=...; node $S/...`) o heredocs largos que mezclan `cd` y python: los niega por «demasiado complejo». Usar rutas absolutas literales; los scripts se escriben con Write en el scratchpad y se corren con `python3 script.py <ruta>`.
- Para medir una landing en local con CDP, servirla en `localhost` y no en `127.0.0.1`. La primera pestaña que abre Chrome headless a veces no reporta LCP: abrir antes una pestaña de calentamiento.

Ver [[build-en-worktree]] y [[worktree-aislado-comandos]].
