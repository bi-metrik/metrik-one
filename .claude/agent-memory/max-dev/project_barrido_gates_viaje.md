---
name: barrido-gates-viaje
description: Barrido de bloques y gates de «Viaje a medida» (2026-10-22, sin migración) — estado derivado de 3 bloques se ESCRIBE al abrir la ficha; saldo_cero cambió para SOENA/AFI
metadata:
  type: project
---

PR `feat/trappvel-barrido-gates` (2026-10-22), sin migración. Origen: Mauricio vio la autorización de datos aprobada y
el bloque en Pendiente.

**Why:** la cabecera de todo bloque lee `negocio_bloques.estado`; autorización/ficha (viven en `contactos`) y servicios
(viven en `negocio_servicios`) nunca lo escribían. Y varios gates fallaban ABIERTOS al no poder leer.

**How to apply:**
- `getNegocioDetalleCompleto` ahora ESCRIBE `estado` de esos tres bloques (completar y reabrir) al abrir la ficha, con
  la regla del gate (`estado-bloques-derivado.ts`). Solo entre pendiente/completo; `rechazado` no se pisa. Si cambias
  un gate de esos tres, cambia la función compartida, no una copia.
- `saldo_cero` usa `lib/cobros/saldo-cero.ts` para TODOS los workspaces: sin fecha / anulado ya no cubren, la retención
  de IVA sí. No medí el impacto en prod (sin MCP en esa sesión): si SOENA reporta un negocio frenado en saldo_cero tras
  el merge, mirar cuotas programadas sin fecha.
- El recargo de emisión es una línea de la cotización (precio manual) → está DENTRO de `precio_aprobado` si alguien lo
  agregó. El `recargo: 0` de `calcularCierre` es el del pago por link, otra cosa.
- Tablero de servicios: el punto puede ser `gris` (falta algo sin urgencia); verde solo si pasa `servicios_listos`.
- El node_modules del checkout principal no trae varias deps: `npm ci --ignore-scripts` en el worktree tarda ~15 s y
  deja tsc/vitest completos verdes.

Relacionado: [[hitos-de-gestion]], [[autorizacion-datos-link]].
