---
name: hook-presupuesto-claude-md
description: El hook de presupuesto de contexto salta en CADA edicion de CLAUDE.md y reporta un desborde PRE-EXISTENTE de `.claude/rules/` que no es tuyo; ademas esa carpeta es de Mik, no de Max
metadata:
  type: project
---

Al editar `metrik-one/CLAUDE.md` salta un `PostToolUse` con
*«PRESUPUESTO DE CONTEXTO EXCEDIDO. rules sin paths: 23990/23000. TOTAL auto-cargado
30965/30000»* y pide condensar, mover a `cerebro/` o scopear con `paths:`.

**Why:** ese texto se auto-carga en cada turno de cada sesion, asi que cada carácter se paga
siempre. Pero **las cifras que reporta son de `.claude/rules/`, no de lo que acabas de
escribir**. Medido el 2026-09-16 (PR #744): salto con el mismo `23990/30965` **antes y
despues** de condensar mi cambio a una cuarta parte. O sea que el hook no mide tu delta —
mide un total que ya estaba desbordado — y es facil leerlo como «lo rompí yo» y ponerse a
recortar lo propio sin efecto.

**How to apply:**

1. **Edita `CLAUDE.md` con presupuesto igual**: deja el reemplazo en el orden de magnitud del
   texto que quitas. Lo que corrige una afirmacion que tu cambio vuelve falsa (un gotcha que
   pide un check que ya construiste) vale la pena; el relato del PR no, para eso esta el PR.
2. **Antes de recortar, compara las cifras de dos disparos seguidos.** Si no se mueven, el
   desborde no es tuyo.
3. **No toques `.claude/rules/` para «arreglarlo»:** por la regla 7 del CLAUDE.md raiz, esa
   carpeta, `.claude/skills/`, `.claude/agents/` y `.claude/hooks/` tienen **owner unica, Mik**.
   El hook lo dice explicito: *«Reportar a Mauricio que se paso y que se propone hacer; no
   decidirlo en silencio.»* Va en el cierre del turno, no en un commit.

⚠️ **`metrik-one/CLAUDE.md` SI lo mantiene Max** (todo el log de sesiones es suyo); la regla 7
apunta al `CLAUDE.md` raiz de `metrik/` y a las carpetas de gobierno. Editar el del producto
para corregir un dato caduco esta dentro del encargo; ampliar `.claude/rules/` no.

Relacionado: [[cifras-del-brief-caducan]].
