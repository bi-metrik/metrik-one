---
name: red-lenta-aguanta
description: ONE aguanta red lenta (2026-10-07, fix/red-lenta-aguanta) — aviso por falta de avance, reintento de chunks/RSC, Supabase fuera de la primera carga; por qué TAMANO_PAGINA sigue en 30 y qué se propuso de Cloudflare
metadata:
  type: project
---

Causa medida el 7-oct (SOENA Movistar/Telmex, Mauricio Comcel): chunks de Vercel 6-16 s CADA UNO pero
llegaban; Cloudflare 0,5 s por la misma red. ONE se rendía antes que la red. Sin migración.

**Decisiones no obvias:**
- El aviso a pantalla completa ya no es reloj: sale con 25 s SIN AVANCE (PerformanceObserver de `/_next/`,
  `load` en `document`, MutationObserver del HTML), tope 2 min. Píldora «conexión lenta» a los 8 s.
- El reintento de chunks DEBE ir antes del `onerror` del runtime (Turbopack guarda el fallo para siempre) y
  la copia con el ATRIBUTO `src` relativo: con la URL absoluta la página no hidrataba nunca (lo vio el e2e,
  no los unit tests — happy-dom no ejecuta Turbopack).
- RSC: el wrapper de `fetch` solo repite si NO hay service worker (el del piloto ya repite: 3×3 intentos).
- `TAMANO_PAGINA` se quedó en 30: tarjeta ~1,1 KB en RSC y ~8 KB en HTML (42 % SVG, 43 % clases); los
  376 KB que midió Mauricio cuadran con el DOCUMENTO, no con el RSC. 15 tarjetas ≈ −1,3 s de 3,6 s; el
  problema eran los chunks.
- Frente 2 (solo propuesta): Vercel desaconseja proxy delante (KB nov-2025); el DNS de metrikone.co está en
  Vercel (wildcard). Lo de menor riesgo: `assetPrefix` a un host de Cloudflare solo para `/_next/static`
  (Vercel sirve ACAO `*` e immutable). Decide Mauricio.

**Why:** criterio de Mauricio: funcionar con baja conectividad en cualquier operador.

**How to apply:** e2e `scripts/aviso-conexion.e2e.mjs` (casos H/I demuestran antes/después; `DETALLE=1`
imprime tiempos). Comparar antes/después = dos builds, `.next` intercambiado (no cabe en /tmp: cuota).
Relacionado: [[aviso-conexion-fallida]], [[piloto-red-soena]], [[recuperacion-red-iphone]].
