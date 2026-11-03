---
name: project-factura-cuota-correo-siempre
description: Factura de cuota sale siempre (campana + correo PDF/XML) por trigger → cola envios_factura_cuota → edge enviar-factura-cuota; PR #1317, migración 20261028120000 SIN aplicar
metadata:
  type: project
---

PR #1317 (rama feat/factura-cuota-correo-siempre, 2026-10-28). Migración `20261028120000_envios_factura_cuota.sql` SIN aplicar al abrir el PR; edge function nueva `enviar-factura-cuota` sin desplegar; `resend-webhook` modificado (escribe acuses en `envios_factura_cuota` por `resend_id`).

**Why:** en prod había 6 facturas_cuota y 0 avisos `factura_cargada`: todas entraron por SQL/script. Mauricio decidió que campana + correo salgan sin importar el camino, así que vive en la base y NO en `cargarFacturaCuota` (si alguien vuelve a avisar desde la action, sale doble).

**How to apply:**
- Orden: deploy enviar-factura-cuota → migración → deploy resend-webhook (antes de la tabla daría 500 a todo acuse) → merge.
- Sin backfill: las facturas viejas se encolan a mano (INSERT en la cola + `select disparar_envio_factura_cuota(id)`).
- Reglas puras ahora en `supabase/functions/_shared/` (aviso-factura-cuota, correo-factura-cuota, enviar-factura-cuota-flujo, remitente-facturacion); `src/lib/email/remitente-facturacion.ts` solo re-exporta. Colores del correo son copia de PALETA con prueba de paridad.
- El job solo reintenta filas sin `correo_enviado_at`, por eso la campana va ANTES del correo.
- El guard IS DISTINCT del trigger es redundante con el UNIQUE NULLS NOT DISTINCT (mutación lo mostró); no es un hueco.
