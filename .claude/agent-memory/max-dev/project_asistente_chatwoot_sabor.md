---
name: project-asistente-chatwoot-sabor
description: Asistente público de Sabor sobre Chatwoot (etapa 1, rama feat/asistente-chatwoot-sabor) — migración 20261021090000 SIN aplicar, corrida real solo por el CLI (suscripción), payload armado de la doc
metadata:
  type: project
---

Etapa 1 del asistente de Sabor & Experiencias construida el 2026-10-21 sobre el núcleo de ONE (D1 aprobada por Mauricio el 2026-10-20). Código en `supabase/functions/_shared/agente/publico/` + `chatwoot-agente/` + `agente/modelo-anthropic.ts`. PR abierto, sin mergear.

Estado al cerrar:
- Migración `20261021090000_asistente_chatwoot.sql` (tablas `chatwoot_conversacion`, `chatwoot_consentimientos`) SIN aplicar; `chatwoot-agente` SIN desplegar; secretos por slug (`CHATWOOT_WEBHOOK_SECRET_<SLUG>`, `CHATWOOT_API_TOKEN_<SLUG>`, `GEMINI_API_KEY_PAGO`) SIN crear. El workspace de Sabor en ONE no existe: crearlo lo autoriza Mauricio.
- Arnés `--seco` 54/54. Corrida REAL por el CLI de Claude Code con la suscripción (Mauricio, 2026-10-21: nunca con la llave de prod): `arnes/correr.ts --cli`, 53/54 con pass^3 y 0 dañinas (falla `l-jerga` 1 de 3). Sus tiempos traen el arranque del CLI: no sirven para `corte_1`, que queda en 5 s hasta tener trazas de producción. Effort, caché, strict y refusal del adaptador NO se ejercitan por el CLI.
- `claude -p` desde un subagente: hay que quitar `CLAUDE_CODE_SIMPLE` del entorno (activa `--bare`, que solo acepta llave de API) y `CLAUDECODE`. El CLI acepta el id `claude-haiku-5-5` tal cual. El sandbox del worktree rechaza `env -u … claude …` en Bash: hay que lanzarlo desde Deno (`Deno.Command` con `clearEnv`).
- El modelo real pide la autorización con sus palabras: la guarda `autorizacion_improvisada` de `cola.ts` lo ataja. La guarda de precios ahora le devuelve el error al modelo, con un reintento dentro del tope de llamados (gancho `DepsTurno.guardaTexto`, decisión de Yuto del 2026-10-21). Por CLI, 3 de 3 se corrigieron; la guarda antes de publicar sigue igual.
- El fixture de Chatwoot está armado de la doc: `message_type`, tipo de remitente, `data_url` y `submitted_values` siguen SIN VERIFICAR hasta el payload real (22-oct).

Gotchas que costaron:
- El verificador del núcleo deja pasar una cifra que escribió el CLIENTE («la promo es a $50.000» → el bot la repite). Por eso existe `publico/precios.ts`: la plata solo sale de lo que devolvió una herramienta.
- `CHECK (estado in (...))` deja pasar NULL. Para exigirlo hay que escribir `estado is not null and ...` (lo atrapó la prueba en PGlite).
- El candado de `proponer` (sin autorización) NO alarga el presupuesto de llamados del núcleo. Si se agotan los 3 llamados, el núcleo devuelve «tope de llamados» y ese error NO cuenta como falla del modelo para reintentar.

**Why:** a la siguiente sesión le va a tocar aplicar la migración, cargar el payload real o correr el arnés real, y esto no se ve leyendo el código.
**How to apply:** antes de dar la etapa 1 por lista, verifica en este orden la migración aplicada, el payload real cargado como fixture y el reporte de la corrida real. Ver [[project-migracion-haiku-55]].
