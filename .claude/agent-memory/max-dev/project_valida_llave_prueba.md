---
name: valida-llave-prueba
description: Llave de prueba de Valida (metrik-valida #53) y como trabajar en otro repo desde un worktree aislado de ONE
metadata:
  type: project
---

Llave de prueba para integradores (decision 9, 2026-10-05: 50 consultas, 15 dias) = metrik-valida PR #53,
SIN migracion: `POST /api/admin/pruebas` crea cliente -> bolsa 0032 a precio 0 (ref `prueba-<id>`) -> llave con
`api_keys.vence_en`. La llave vence a proposito: la bolsa no mide las rutas no facturables (cotejo dual
`billable=false`), que con la llave viva quedarian abiertas para siempre. Emision solo por admin; el formulario
de autoservicio (brecha #6) aun no existe. Mismo PR: ANS v1.2 retira "500 filas en 5 min" (numeral 12 pide
avisar 30 dias a clientes vigentes: Emilio).

**Why:** el aislamiento de worktree bloquea `cd`/`git -C` hacia otro repo compartido (metrik-valida).
**How to apply:** clonar desde GitHub a `/tmp/<nombre>` y trabajar ahi (git, npm ci, gh). Heredocs largos en
Bash a veces se rechazan: escribir archivos con Write. `lib/portal/aislamiento.test.ts` tarda >10 min en
local (aplica todas las migraciones en PGlite): no es un cuelgue, dejarlo a CI.
