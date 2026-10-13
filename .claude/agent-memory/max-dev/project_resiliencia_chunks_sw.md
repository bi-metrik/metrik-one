---
name: resiliencia-chunks-sw
description: Resiliencia de chunks y SW de estáticos para todos (2026-10-12, fix/resiliencia-chunks-red) — carrera con el runtime de Turbopack, llave sin ?dpl, cómo se mide con proxy de pérdida
metadata:
  type: project
---

Claro móvil → Vercel perdía paquetes (trappvel, 12-oct). PR fix/resiliencia-chunks-red, sin migración, NO mergeado
por Max (la sesión decide).

**Decisiones no obvias:**
- La causa del «Failed to load chunk … from module N» NO era falta de reintentos: el cliente RSC pide los chunks de
  la página por URL y, si el `<script>` está en el HTML, el runtime hace `addEventListener('error')` sobre ESE
  elemento. Se corta el `error` en la ventana (captura) mientras quedan intentos; agotados, se re-dispara a los
  anteriores. Los chunks de arranque (otherChunks del runtime) se esperan por registro y no tenían el problema.
- SW en todos los workspaces solo para `/_next/static/chunks|media` con hash; llave SIN `?dpl=` porque mismo nombre
  = mismos bytes entre deployments (medido con curl contra dos dpl de prod). El HTTP cache no sirve para eso: su
  llave lleva `?dpl=`.
- Fuera del piloto: Static Routing API (`addRoutes`) y navigation preload APAGADO (si no, cada página se pediría
  dos veces). Lista `PILOTO` en sw.js debe igualar `WORKSPACES_PILOTO_RED` (test).

**Why:** criterio de Mauricio: ONE debe aguantar cualquier operador; la ruta del ISP no se arregla.

**How to apply:** medir con `scripts/sw-estaticos.e2e.mjs` (proxy que corta sockets; `PERDIDA`, `SEMILLA`,
`SOLO_SIN_SW`) — `page.route` con aborto instantáneo NO reproduce la carrera. `next start` con el mismo
`VERCEL_DEPLOYMENT_ID` del build o no hidrata. Antes/después: 6/10 → 0/10 cargas caídas al 60 % de pérdida.
Ojo: `pkill -f next-server` mata la propia shell del Bash (exit 144): matar por pid de `ss -ltnp`.
Relacionado: [[red-lenta-aguanta]], [[piloto-red-soena]], [[aviso-conexion-fallida]].
