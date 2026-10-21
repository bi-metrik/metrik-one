---
name: project-asistente-chatwoot-sabor
description: Asistente público de Sabor sobre Chatwoot (etapa 1, rama feat/asistente-chatwoot-sabor) — migración 20261021090000 SIN aplicar, sin corrida real, payload armado de la doc
metadata:
  type: project
---

Etapa 1 del asistente de Sabor & Experiencias construida el 2026-10-21 sobre el núcleo de ONE (D1 aprobada por Mauricio el 2026-10-20). Código en `supabase/functions/_shared/agente/publico/` + `chatwoot-agente/` + `agente/modelo-anthropic.ts`. PR abierto, sin mergear.

Estado al cerrar:
- Migración `20261021090000_asistente_chatwoot.sql` (tablas `chatwoot_conversacion`, `chatwoot_consentimientos`) SIN aplicar; `chatwoot-agente` SIN desplegar; secretos por slug (`CHATWOOT_WEBHOOK_SECRET_<SLUG>`, `CHATWOOT_API_TOKEN_<SLUG>`, `GEMINI_API_KEY_PAGO`) SIN crear. El workspace de Sabor en ONE no existe: crearlo lo autoriza Mauricio.
- Arnés `--seco` 53/53 con pass^3. La corrida real nunca corrió: no había `ANTHROPIC_API_KEY_PRUEBAS` (el runner rechaza la llave de prod a propósito). El p95 y el `corte_1` salen de esa corrida.
- El fixture de Chatwoot está armado de la doc: `message_type`, tipo de remitente, `data_url` y `submitted_values` siguen SIN VERIFICAR hasta el payload real (22-oct).

Gotchas que costaron:
- El verificador del núcleo deja pasar una cifra que escribió el CLIENTE («la promo es a $50.000» → el bot la repite). Por eso existe `publico/precios.ts`: la plata solo sale de lo que devolvió una herramienta.
- `CHECK (estado in (...))` deja pasar NULL. Para exigirlo hay que escribir `estado is not null and ...` (lo atrapó la prueba en PGlite).
- El candado de `proponer` (sin autorización) NO alarga el presupuesto de llamados del núcleo. Si se agotan los 3 llamados, el núcleo devuelve «tope de llamados» y ese error NO cuenta como falla del modelo para reintentar.

**Why:** a la siguiente sesión le va a tocar aplicar la migración, cargar el payload real o correr el arnés real, y esto no se ve leyendo el código.
**How to apply:** antes de dar la etapa 1 por lista, verifica en este orden la migración aplicada, el payload real cargado como fixture y el reporte de la corrida real. Ver [[project-migracion-haiku-55]].
