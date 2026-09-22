---
name: project-iva-ingreso-propio
description: IVA de la cotización sobre el ingreso propio (Trappvel, regla de Felipe 22-sep) — PR #830 sin mergear; DDL antes del merge, config de Trappvel después del deploy
metadata:
  type: project
---

PR #830 (rama `trappvel/iva-sobre-ingreso-propio`), abierto el 2026-09-22 y **sin mergear**.
El IVA de una cotización va sobre precio − costo del tercero, línea por línea, con UNA
función (`src/lib/fiscal/iva-cotizacion.ts`) que usan PDF, editor y «Aprobar».

**Why:** regla fiscal de Felipe en el brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-22-iva-sobre-el-ingreso-propio.md`.
Si una de las tres superficies calcula por su cuenta, el comercial cotiza una cifra y el
documento o el cobro dicen otra.

**How to apply:**
- Orden: (1) `supabase/migrations/20260923120000_items_base_iva.sql` ANTES del merge;
  (2) merge + deploy; (3) `proyectos/trappvel/clarity/migrations/2026-09-23_iva-ingreso-propio-config-PENDIENTE.sql`
  DESPUÉS del deploy. Sin (3) nada cambia para nadie; la regla es opt-in por
  `config_extra.iva_cotizacion.base = 'ingreso_propio'`.
- ⚠️ Hallazgo que el brief no traía: el PDF de Trappvel imprimía IVA **$0** porque
  `calcularFiscal` no reconoce `tax_regime = 'ordinario'` como responsable de IVA. El camino
  viejo se dejó intacto para los demás workspaces (las pruebas lo fijan por igualdad exacta).
  Con la regla encendida, el total del PDF SUBE (0002: $15,44 M → $15,88 M), no baja.
- `en_documento = 'linea_incluida'` es provisional hasta que Edgar confirme o pida `oculto`.
- Abierto: tableros (19 % estimado) y `v_negocio_valor` no leen esta regla.

Relacionado: [[project-margen-recargo-configurables-trappvel]], [[project-documento-cliente-trappvel]].
