---
name: ferreteria-webhook-wompi
description: PR #953 — webhook de Wompi de Dimpro registra ventas de Ferretería sin sesión; migración 20260928170500 SIN aplicar (solo esquema, ANTES del merge); crearNegocio partido en acción + crearNegocioEnWorkspace; supuestos sin verificar del payload
metadata:
  type: project
---

PR #953 (rama `feat/ferreteria-webhook-wompi`, 2026-09-28). `POST /api/ferreteria/wompi/eventos`: un pago
APPROVED de prod de un link con `sku` = código MP registra la venta anticipada por `registrarVenta`. Sin sku
→ `pendiente_asignar` + «Asignar» en la pestaña Pagos Wompi. Ver [[modulo-ferreteria-dimpro]].

⚠️ Al cerrar: migración `20260928170500_ferreteria_pagos_wompi.sql` **SIN aplicar** (solo esquema) y env
vars `WOMPI_DIMPRO_EVENTS_SECRET` / `WOMPI_DIMPRO_PRIVATE_KEY` sin cargar. Orden: migración → merge →
env vars → URL en el panel de Wompi. No mergeado por encargo.

**Why:** sin la tabla el webhook da 500; Wompi solo reintenta 3 veces (30 min, 3 h, 24 h) y luego el evento
se pierde.

**How to apply:**
- `crearNegocio` ahora es sesión + módulo + `crearNegocioEnWorkspace` (`src/lib/negocios/crear-negocio.ts`,
  NO 'use server'). Todo cambio al cuerpo de crear negocio va ahí. Camino sin sesión = `puertoNegociosSistema`.
- El camino sin sesión (service_role creando negocio, contacto, cobro) nunca corrió contra la base real:
  el primer pago real es la prueba de integración. Sandbox NO registra ventas (a propósito: previews usan
  la base de prod).
- Sin verificar contra un evento real: que `transaction.updated` traiga `customer_data`, `shipping_address`
  y dónde llega el «Cedula o NIT» de `customer_references`. Se leen defensivo y la llave privada completa.
- El vector de la doc de eventos (checksum 3476DDA5…) NO es el SHA256 de su propia cadena de ejemplo; el
  test usa un vector recalculado con Python.
- `WOMPI_*` sin DIMPRO están reservadas al comercio propio de METRIK IA (`pasarela/wompi.ts`): no mezclar.
- `notificaciones_tipo_check` se amplía leyendo `pg_get_constraintdef` + regexp, no reescribiendo la lista.
