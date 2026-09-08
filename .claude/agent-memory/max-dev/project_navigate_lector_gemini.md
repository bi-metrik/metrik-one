---
name: navigate-lector-gemini
description: Lector del motor Navigate (Cardumen) — PR #570 mergeado el 2026-09-08 pasa el lector de Haiku a gemini-3.1-flash-lite; wa-webhook NO redesplegado por Max (lo hace Mik); qué queda abierto en el golden set y un hueco del intérprete que 2.5 destapó
metadata:
  type: project
---

**El lector de Navigate es Gemini, no Haiku** (decisión textual de Mauricio, 2026-09-08:
"No leamos con haiku, prefiero mantener gemini"). PR #570, merge `8dfc40f9`. El modelo es
`GEMINI_LECTOR_MODELO = "gemini-3.1-flash-lite"` en `_shared/cardumen/model.ts`; R1/R2
(Araucanía/Trappvel) siguen en `claudeHaiku()` y no se tocan.

**Why:** el golden set de 84 casos, corrido DOS veces por modelo con el adaptador de
producción (resultados idénticos): 2.5-flash-lite 78/84 con 2 falsas ubicaciones y 2 no
lecturas; 3.1-flash-lite 83/84 con 1 falsa y 0 no lecturas. Regla del encargo: el más barato
que iguale o supere al otro; 2.5 no iguala. Costo USD 0,0154 vs 0,0054 por los 84 casos
(precio oficial consultado ese día), irrelevante frente a la métrica.

**How to apply:**
- ⚠️ **El merge NO despliega `wa-webhook`.** Hasta que Mik lo redespliegue, producción sigue
  leyendo con Haiku (el deploy anterior fue con el PR #567). Si alguien reporta que el lector
  "sigue en Haiku", comprobar el deploy antes de tocar código. El PR #574 (idioma primero,
  2026-09-08) espera el mismo redespliegue: un solo deploy de `wa-webhook` cubre los dos.
- `GEMINI_API_KEY` ya está en los secrets de `wa-webhook`: la usan `venezuela/`, `wa-parse` y
  `wa-transcribe`. No hay secreto nuevo que crear.
- **Un modelo Gemini sin fila en `PRECIOS_GEMINI` no se instancia** (lanza). Para probar otro
  modelo con `--modelo`, primero se registra su precio mirando la doc, no de memoria.
- **Lo que sigue abierto con 3.1:** D-20 ("nuevo no del todo, pero se aceleró mucho este año",
  categoría matiz) se lee como ancla firme. Pasa por eco + confirmación, pero cuenta como falsa.
- **Hueco del intérprete que 2.5 destapó:** en el punto `segundo`, si el modelo devuelve
  `{"claro":false,"ninguno":true}` el intérprete lo deja como "no leído" (S-12 "ninguno"). En
  tríadas un `especial` sí cuenta como lectura aunque `claro` sea false; en `segundo` no hay
  esa tolerancia. Con 3.1 no se manifiesta (devuelve `claro:true`). Fuera de alcance del PR
  #570; si se cambia de modelo otra vez, volver a mirar.
- El eval (`scripts/navigate-lector-eval.ts`) corre los adaptadores REALES con un `Deno.env`
  mínimo para Node y lee `GEMINI_API_KEY` de `.env.local` (symlink relativo en el worktree).
  Sale con código 1 si hay alguna falsa ubicación: con 3.1 hoy sale 1 por D-20, no es un fallo
  del script.

Relacionado: [[worktree-git-bloqueado]], [[medicion-sin-mcp-supabase]].
