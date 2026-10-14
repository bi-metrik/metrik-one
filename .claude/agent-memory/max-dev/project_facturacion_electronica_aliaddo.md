---
name: facturacion-electronica-aliaddo
description: Factura electrónica automática por cobro con Aliaddo/Muisca (feat/facturacion-aliaddo, 2026-10-14). Apagada; migración 20261014233000 SIN aplicar; sin cuenta ni token. La numeración la carga Mauricio a mano; los CDA quedan fuera del alcance a propósito.
metadata:
  type: project
---

Rama `feat/facturacion-aliaddo`, PR en borrador. Código en `src/lib/facturacion-electronica/`, cron
`/api/crons/facturas-electronicas` cada 30 min, gancho `facturarPago` en `RepoPagoEnLinea`.

**Why:** Mauricio (2026-10-14): los cobros automáticos se facturan con Aliaddo (plan Business Plus
multiempresa, cotización #29550). Felipe (`crecimiento-mrr/29-felipe-iva-suscripcion.md` §5): una
factura validada por cobro aprobado, el mismo día; excluida de IVA; el ítem nunca dice «licencia».

**How to apply:**
- Apagada sin `FACTURACION_ELECTRONICA_HABILITADA=1`. `Production` solo con `VERCEL_ENV=production`,
  y producción solo en `Production` (los previews usan la base real).
- **Migración 20261014233000 SIN aplicar.** Sin fila en `facturacion_numeracion` la emisión queda
  `bloqueada` y avisa: no se emite nada hasta que Mauricio cargue prefijo y siguiente consecutivo.
- ONE pone el consecutivo (Muisca lo exige): se asigna UNA vez por RPC y el reintento manda el mismo;
  antes de reenviar se busca por prefijo+consecutivo y se adopta (o se bloquea si es de otro comprador).
- Alcance: solo `negocios.metadata.origen = 'valida_autogestion'`. Los 4 CDA usan la MISMA ficha
  (`valida-cda-licencia`) pero se facturan a mano por `facturas_cuota`: por eso el alcance va por
  origen y no por slug.
- El cobro con tarjeta de #1110 pasa por `procesarEventoPasarela` → ya queda cubierto, sin gancho nuevo.
- Sin verificar contra cuenta real: ítem excluido sin `taxes`, `responsibilities` como texto,
  `firstName/lastName` de persona jurídica, valores de `Status` distintos de «Aprobada», y contra qué
  host se resuelven `UrlPdf`/`UrlXml…` (vienen relativas → `ALIADDO_ARCHIVOS_URL`).
- Factura de Production archivada se copia a `facturas_cobro` (la ve el cliente en /valida-api).

Relacionado: [[factura-cobro-servicio]], [[valida-alta-autogestionada]], [[worktree-ocupado-por-otro-max]].
