---
name: post-cotizacion-f3-f5
description: Post-cotización Trappvel ola 4 (2026-10-12) — F3 reservas y pagos (#1119), F5 facturación por evento (#1120) y Siigo listo para enchufar (#1123); apilados sobre #1117, sin migraciones
metadata:
  type: project
---

Ola 4: #1119 (F3), #1120 (F5) y #1123 (adenda Siigo, sobre #1120), todos apilados sobre #1117 → retarget a `main`
antes de cada merge. Sin migraciones. `wa-webhook` cambia en #1119 y NO está desplegada (la despliega la sesión
principal tras el merge).

**Why:** decisiones que no se ven en el código y cambian lo que sigue:
- Piso de la desviación sale en $0 (Vera N1 manda sobre el brief, que decía $50.000): configurable en
  `servicios_viaje.piso_desviacion_pesos`.
- Una fila de $0 sin pagos (el recargo fijo de F0) NO frena `servicios_listos`.
- `gastos` no tiene anulación: «Alejandra anula el gasto con motivo» (C5) quedó pendiente; pide columna.
- F5 lee `metadata.paquete_viaje.enviado_at`: F4 tiene que escribirla al enviar el paquete.
- El doble de la cola (`test/cola-facturacion-doble`) no resuelve embeds de PostgREST: `reglaDelNegocio` lee la
  línea aparte por eso.
- Una factura de viaje nunca sale con el producto de SOENA: sin `productoPropioCode`/`productoTercerosCode`, falta.

**How to apply:**
- El día de las credenciales: setup `--viajes` → `check-siigo` → `simular-siigo-desde-one --viajes` (runbook en
  `docs/specs/2026-10-12_runbook-conectar-siigo-viajes.md`).
- Pendientes de Vera: F3-5 correo al equipo, F3-8 prueba con el número de Alejandra, F3-9 medición y Deshacer en
  campos, F5-2 factura en Siigo de pruebas (D-1), F5-4 reintento solo, propuesta del bot por el modelo (C12).

Relacionado: [[post-cotizacion-f2]], [[post-cotizacion-servicios-f0]], [[pruebas-por-mutacion]].
