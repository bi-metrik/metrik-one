---
name: epoca-no-recargar-por-deploy
description: Desde 2026-10-03 el VersionWatcher no recarga por deploy; recarga por EPOCA (src/lib/version/epoca.ts) o techo 8 h diferido; fetch propios van por fetchPropio
metadata:
  type: project
---

Un deploy normal ya no recarga la pestaña (PR fix/no-recargar-por-deploy, 2026-10-03). Motivos que
quedan: subir `EPOCA` a mano (recarga/avisa como antes) y el techo de 8 h, que solo actúa en la
siguiente navegación interna (carga completa del destino) o al volver a la pestaña sin trabajo.

**Why:** 76 deploys/semana × ~771 KB de JS por recarga, y Telmex/Claro (64 % del tráfico) pierde
9 de 20 descargas a Vercel. Skew Protection (Maximum Age 7 días) cubre a la pestaña vieja.

**How to apply:**
- PR que borra/renombra/cambia de tipo algo que el código viejo usa → sube `EPOCA` en el mismo PR.
  La guarda `scripts/check-migracion-epoca.mjs` lo exige para migraciones; marca de escape
  `-- epoca: no-rompe <motivo>`. Vista/función borrada y recreada en el mismo archivo = solo aviso
  (no ve si la vista perdió columnas o la función cambió argumentos obligatorios).
- Cambios de contrato SIN migración (server action, forma de un JSON de `/api`) no los ve la guarda:
  subir la época a criterio.
- Todo `fetch('/api/...')` nuevo del cliente va por `fetchPropio` (header `x-deployment-id`);
  `/api/version` NO (debe llegar al vivo). Next solo sella assets, RSC, prefetch y server actions
  (doc Vercel Skew Protection, revisada 2026-10-03). El id viene de `process.env.NEXT_DEPLOYMENT_ID`,
  que Next inlina desde `deploymentId`.
- Navegación programática nueva con `router.push` fuera de `navegar`/`CardLink` NO convierte la
  recarga pendiente; si importa, llamar `cargarCompletoSiToca(href)` antes.

Relacionado: [[respuesta-al-tocar]], [[recuperacion-red-iphone]].
