---
name: factura-cobro-servicio
description: PR #876 (2026-09-23) — factura electrónica por COBRO (`facturas_cobro`) visible en /valida-api; migración 20260924090000 SIN aplicar al abrir; el CUFE de la FE-1 en la metadata está mal copiado (90 de 96)
metadata:
  type: project
---

PR #876 (`feat/factura-electronica-cobro-servicio`): tabla `facturas_cobro` (server-only,
hermana de `facturas_cuota`) + `mis_cobros_de_servicio` con 5 columnas de factura + columna
«Factura» en Pagos de `/valida-api` + clases `factura` / `factura_xml` en la ruta de descarga.
**Migración `20260924090000_facturas_cobro.sql` SIN aplicar** al abrir el PR; no se mergea antes.

**Why:** 4D SOFT no veía su FE-1. El brief proponía `cobros.factura` jsonb; se descartó porque
`cobros` tiene UPDATE para `authenticated` (`arwdm`), así que la ruta del PDF del cliente sería
reescribible por PATCH. Mismo criterio que #849 con `plan_cobro_cuotas`.

**How to apply:**
- ⚠️ El CUFE en `negocios.metadata.factura_electronica.cufe` (negocio bc069e90) tiene **90**
  caracteres; un CUFE-SHA384 tiene 96. El CHECK de la tabla lo rechaza a propósito: hay que
  sacarlo del XML (`<cbc:UUID schemeName="CUFE-SHA384">`). El SQL de carga está en el cuerpo del PR.
- Rutas en Storage: `<ws cobrador>/facturas/<sha256>.<pdf|xml>`, la misma convención de
  `rutaFactura` en `valida-cda/factura-cuota.ts` (contenido direccionado, no choca con las de cuota).
- Los CDA en `/suscripcion` siguen con factura POR CUOTA; la de cobro solo se pinta en `/valida-api`.
- Si alguien vuelve a tocar `mis_cobros_de_servicio`: DROP + CREATE y reponer la ACL
  (`revoke ... from public, anon` + `grant ... to authenticated`).

Relacionado: [[valida-cda-gracia-facturas]], [[pglite-version-de-ci]].
