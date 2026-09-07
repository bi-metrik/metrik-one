---
name: hook-ownership-no-reconoce-teammate
description: Corriendo como teammate (SendMessage/equipo), el hook code-ownership-one bloquea TODA escritura en metrik-one, incluido git worktree add
metadata:
  type: project
---

El hook `code-ownership-one` solo deja pasar si `agent_type` es `max-dev`/`max`
o si existe `/tmp/metrik-max-active-<session_id>.flag`. Cuando Max corre como
**teammate** dentro de una sesión de equipo, el `agent_type` no es ninguno de
los dos y el flag pertenece a otro session_id: queda bloqueada toda escritura en
`metrik-one/`, incluido `git worktree add`. Lecturas y el MCP de Supabase sí pasan.

**Why:** el override por `agent_type` se diseñó (2026-07-14) para el subagente
ejecutor de Max, que corre con otro session_id. El caso teammate no estaba
contemplado. Verificado el 2026-08-25 en la tarea del catálogo de tier.

**How to apply:** no crear el flag a mano — es un control de permisos y las
instrucciones de Max lo prohíben. Se pide que Mauricio invoque `/max` una vez en
ESA sesión (el hook hermano `mark-active-agent.sh` crea el flag), o el trabajo de
escritura lo ejecuta una sesión Max principal. Mientras tanto sí se puede avanzar
todo lo que no escribe: verificación contra producción por MCP, y redactar y
**probar** el código en el scratchpad — con `node_modules` de metrik-one
symlinkeado ahí, `vitest` y `tsc --strict` corren completos.

Dos falsos positivos del resolutor que aparecen al intentar rodearlo (reportables
a Mik): una variable de shell en la ruta (`cd $S/probe`) se resuelve literal
contra el cwd, y `node /ruta/script.mjs` se lee como escritura sobre el script.
El workaround es rutas absolutas literales y copiar el script al scratchpad.
