---
name: aviso-conexion-fallida
description: Aviso «No pudimos conectar con ONE» (2026-10-06, fix/aviso-conexion-fallida) — respaldo sin chunks en el head, espera con tope por CSS, copia nueva del agotado; por qué módulo async y por qué quita hojas
metadata:
  type: project
---

ONE ya no se queda cargando ni en blanco (capturas de Deisy, SOENA, Claro/Telmex). Sin migración.

**Decisiones no obvias:**
- El respaldo va como `<script type="module" async>` en línea: un script clásico del `<head>` NO corre
  mientras cuelga una hoja de estilo de Next (van antes). Medido en Chromium con `page.route`.
- Antes de pintar el aviso a pantalla completa QUITA las hojas con `sheet === null`: una hoja colgada
  bloquea el pintado entero (= la pantalla en blanco). Las devuelve si React hidrata después.
- La espera de `loading.tsx` y de `CapaNavegacionPendiente` tiene tope por CSS (animación con retardo de
  25 s, keyframes en un `<style>` en línea), no por JS: el fallback de un stream cortado nunca hidrata.
  El botón no lleva onClick: `data-one-reintentar`, lo atiende el script con un listener de documento.
- Texto aprobado por Mauricio el 6-oct: SÍ nombra la conexión («puede ser») y manda a otra red; revierte
  el «no culpar la señal» del 3-oct solo para el aviso final. Mientras reintenta sola, sigue sin hablar.

**Why:** la escalera de `auto-recarga.ts` solo actúa si React montó un error.tsx; sin hidratar o con un
stream colgado sin error, nadie la disparaba.

**How to apply:** contar avisos con `[error-cliente]` `message:"aviso-conexion-mostrado"` por `causa`
(sin-hidratar, chunk, espera-ruta, navegacion, agotado), contando por `id`. Probar cambios con
`scripts/aviso-conexion.e2e.mjs` contra `next start` local (Playwright screenshot espera fuentes:
usar CDP `Page.captureScreenshot`). No hay CSP en ONE; si se agrega, el script necesita nonce.
Una página que el servidor ni empieza a mandar (sin un byte de HTML) sigue sin cubrirse: eso solo lo
ve el service worker del piloto. Relacionado: [[recuperacion-red-iphone]], [[piloto-red-soena]],
[[respuesta-al-tocar]].
