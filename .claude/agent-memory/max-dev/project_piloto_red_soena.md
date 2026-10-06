---
name: piloto-red-soena
description: Piloto de red en soena (2026-10-06) — Fase 0 contradijo «descargas y procesamiento»; pulso + [red-piloto] por persona (#1042), service worker con interruptor (#1045), tabla red_eventos SIN aplicar (pieza 3, PR abierto)
metadata:
  type: project
---

Brief `proyectos/soena/ve/2026-10-06_brief-max-piloto-red-documentos.md` (+ agregado «medir por persona»).

**Fase 0 (medido 2026-10-06) contradijo la intuición de Mauricio:** lo que falla son cargas de página y
navegaciones RSC de `/negocios/[id]` y `/negocios` en Telmex/Claro (`network error` = stream cortado a
medias). Las DESCARGAS de soena abren en Drive (19 por `/api/archivos/abrir` en 14 días) y no tocan Vercel;
las SUBIDAS van del navegador a Supabase Storage (`upsert` a ruta fija: reintentar no duplica) y no dejaban
rastro; el procesamiento ya va en `after()` y la marca vencida a 90 s da «Reintentar». La bandeja de
subidas (IndexedDB) NO se construyó: sin evidencia de falla; primero medir con el pulso.

**Decisiones no obvias:**
- Persona por NOMBRE normalizado (`PERSONAS_MEDIDAS` en `src/lib/red/piloto.ts`), no por id: la lectura de
  `staff` con la llave de servicio la negó el clasificador. La ruta resuelve el `staff.id` de la sesión.
- Operador por DNS de Team Cymru (Vercel no da ASN en cabeceras de la función; sí en métricas `asn_name`).
- Sonda a Vercel = `/pulso.png` (extensión excluida del matcher: sin middleware ni función).
- El SW NO guarda respuestas (cero riesgo de servir datos ajenos); RSC se lee entero para poder repetirlo.
- `/sw.js` necesita pasar el middleware sin sesión: un SW que redirige no se actualiza y el apagado no llega.

**Why:** la escala objetivo es 100 personas en toda Colombia, cualquier operador (Mauricio, 2026-10-06).

**How to apply:** medir el después con `node scripts/red-resumen.mjs --bajar 3d` (logs `[red-piloto]`) y
probar cambios del SW con `scripts/sw-piloto.e2e.mjs` (playwright-core en el scratchpad, Chromium en
`~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`). Relacionado: [[cargue-segundo-plano]],
[[recuperacion-red-iphone]], [[rum-y-lecturas-sin-actions]].

**Pieza 3 (feat/red-eventos-tabla, SIN mergear):** migración `20261006121500_red_eventos_piloto.sql` crea
`red_eventos` + `v_red_resumen_diario` (server-only, sin grant). La aplica la sesión principal ANTES del
merge; el código escribe con `after()` y si falta la tabla solo loguea el error. Probada en PGlite.

**Gotchas del entorno:** `vercel logs --json` con ventana larga devuelve UNA ventana de filas repetidas
(3000 filas = 50 reportes): bajar en tramos de 15-30 min. `vercel metrics` de 14 días con varios
`--group-by` da `query_timeout`: consultar día por día. El hook `limpiar-tras-merge` BORRA el worktree en
cuanto `gh pr merge` termina: commitear la memoria antes y recrear con
`git worktree add <ruta propia> -b <rama> origin/main` desde el directorio vacío.
