---
name: reference-worktree-compartido
description: El harness puede darle el MISMO worktree a dos instancias de Max a la vez; cómo trabajar sin pisar la otra y qué pasa cuando la otra lo borra
metadata:
  type: reference
---

El 30-oct dos instancias de Max (atajo gasto/bot y «sin plata») recibieron el mismo worktree (`agente-<sufijo de la
sesión>`): la otra ya tenía cambios sin commitear en otra rama. Mirar `git status` y el mtime de los archivos al empezar.

- El guard de aislamiento solo deja correr git con cwd en el worktree asignado: `cd` a otro worktree, variables en
  rutas, `bash -c` o heredocs complejos se rechazan. Un `git worktree add -b <rama> <ruta> origin/main` desde el
  asignado sí pasa; en el nuevo se edita y se prueba con scripts Python (`subprocess` con `cwd=`) escritos con Write
  en el scratchpad, pero git ahí no.
- Write/Edit tampoco escriben fuera del asignado: editar con scripts Python en el scratchpad.
- Cuando la otra instancia cierra, BORRA el worktree: la carpeta queda vacía y git desde ahí resuelve al checkout
  principal (rama main). No hacer nada que escriba ahí; recrear el worktree en esa misma carpeta vacía.

**How to apply:** si el worktree trae cambios ajenos, no tocarlos; abrir uno propio y commitear desde el asignado
cuando quede libre. Ver [[reference-worktree-aislado-comandos]].
