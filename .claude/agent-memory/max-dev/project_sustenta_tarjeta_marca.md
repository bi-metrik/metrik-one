---
name: project-sustenta-tarjeta-marca
description: Tarjeta de Sustenta en /suscripcion (spec Mateo/Ren 2026-09-23) — migración sugerencias_eventos SIN aplicar al abrir el PR; la medición falla en silencio sin ella; trampa del CHECK con NULL
metadata:
  type: project
---

PR de `feat/sustenta-tarjeta-marca` (2026-09-23) reemplaza el bloque gris de Sustenta del #851 por
tarjeta con marca + panel + medición. Migración `20260924080000_sugerencias_eventos.sql` NO
aplicada al abrir el PR (la aplica la sesión principal antes del merge).

**Why:** la medición escribe en `sugerencias_eventos`; sin la tabla, `registrarEventoSugerencia`
loguea el error y la pantalla sigue (a propósito), así que el merge sin migración NO rompe nada
visible pero **pierde los eventos en silencio**. El CTA depende además de `interes_servicios`
(migración del #851, `20260924060000`): si esa no está, el CTA falla como antes.

**How to apply:**
- Conversión por CDA: la consulta de ejemplo está en la cabecera de la migración.
- ⚠️ El CHECK de `origen` necesitó `origen is not null`: `evento='cta' and origen in (...)` con
  origen NULL da NULL y un CHECK con NULL deja pasar. Lo cazó la prueba PGlite, no la lectura.
- Capturas y contraste se hicieron con el CSS del `.next` recién compilado + chrome
  `--force-prefers-reduced-motion` (así la matriz, que arranca en `motion-safe:opacity-0`, sale
  visible) y un `.mjs` de solo lectura por CDP. `next build` SÍ corrió en esta sesión.

Relacionado: [[project-seccion-suscripcion-cda]], [[medir-contraste-en-el-render]].
