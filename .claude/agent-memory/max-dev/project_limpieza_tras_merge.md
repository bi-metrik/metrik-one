---
name: project-limpieza-tras-merge
description: Hook PostToolUse que limpia worktree y rama al mergear un PR de metrik-one; el settings.json vivo NO es el de metrik-system y el registro quedo pendiente
metadata:
  type: project
---

2026-09-28: construido `.claude/scripts/limpiar-tras-merge.sh` + hook `.claude/hooks/limpiar-tras-merge-hook.py` + 14 pruebas (`test_limpiar_tras_merge.py`), commit 1e819191 en metrik-system. Aprobado por Mauricio.

Gotchas medidos:
- `/home/mauricio/Developer/metrik/.claude/settings.json` es un ARCHIVO propio (no symlink), divergido del de metrik-system. El vivo es ese. Desde un worktree aislado no se puede editar (el tool lo trata como checkout compartido).
- `metrik/.claude/scripts` no existe: solo `hooks`, `rules`, `skills`, `state`, `agents` son symlinks. Todo hook que busque `../scripts` debe usar `realpath(__file__)`.
- En worktree aislado, `git -C <otro worktree>` esta vetado: el inventario de "sucio" lo corre la sesion principal. Confirmado otra vez el 2026-09-28 con la "pasada por las mesas": tambien bloquea borrar worktrees ajenos. Si el brief pide limpiar worktrees, avisar ANTES de empezar que va sin isolation.
- db4137b5 (metrik-system): el script rescata agent-memory y trata como limpio el worktree sucio solo por ella. MEM_DEST real = `metrik/.claude/agent-memory` (carpeta propia, NO la de metrik-system).
- Bug en `hooks/remove-worktree.sh` linea 55: `grep -qxF "$LINEA"` sin `--`; las entradas "- [..]" del indice fallan como opcion y se DUPLICAN en cada rescate. Arreglado solo en el script; el hook es de Hana/Mik.

**Why:** el brief decia que settings.json era symlink; registrar solo en metrik-system deja el hook inerte.
**How to apply:** al tocar hooks, registrar en el settings vivo de la raiz, y verificar con `ls -la metrik/.claude/`.
