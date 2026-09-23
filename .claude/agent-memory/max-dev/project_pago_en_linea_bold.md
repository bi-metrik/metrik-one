---
name: pago-en-linea-bold
description: PR #850 (2026-09-23) — pago en línea de cuotas por enlace + webhook; Bold es TEMPORAL detrás de PasarelaAdapter; migración pasarela_eventos SIN aplicar; lo que la doc de Bold no deja claro
metadata:
  type: project
---

PR #850 (`feat/bold-enlaces-y-webhook`): «Generar enlace de pago» por cuota en la ficha del negocio +
`POST /api/webhooks/bold`. **Migración `20260924030000_pasarela_eventos.sql` SIN aplicar al abrirlo**
(va antes del merge: sin la tabla, un webhook firmado responde 500).

**Why:** decisión de Mauricio (2026-09-23): **Bold es temporal**, todo migra a ePayco cuando exista la
cuenta en Davivienda. Por eso solo `pasarela/bold.ts` y su ruta saben de Bold; tablas, UI («Pagar en
línea», «Pago en línea») y el registro del pago (`src/lib/cobros/pago-en-linea.ts`) son genéricos.

**How to apply:**
- La pasarela de los enlaces sale de un DATO: `planes_cobro.pasarela` o, si el plan dice `manual`,
  `workspaces.config_extra.cobros.pasarela_en_linea`. Sin eso el botón responde «no hay pasarela». Migrar
  a ePayco = adaptador + ruta copia + cambiar ese valor (lista completa en el cuerpo del PR).
- El pago se registra con `confirmarPagoCobroProgramado` (misma escritura que «Confirmar pago manual»);
  no abrir un segundo camino de escritura a `cobros`.
- ⚠️ Doc de Bold inconsistente: `expiration_date` en nanosegundos según el texto pero ejemplos de 13
  dígitos; `metadata.reference` puede llegar como la referencia enviada o como `LNK_…`. Se acepta todo;
  confirmarlo con la llave de pruebas antes del primer enlace real.
- ⚠️ En modo pruebas Bold firma el webhook con llave VACÍA; el webhook la rechaza a propósito.
- La firma es HMAC-SHA256 sobre el **base64** del cuerpo crudo, no sobre el cuerpo.

Relacionado: [[suscripciones-cobro-automatico]], [[valida-cda-gracia-facturas]], [[idempotencia-cuentas-cobro]].
