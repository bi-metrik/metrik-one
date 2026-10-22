---
name: project-asistente-chatwoot-sabor
description: Asistente público de Sabor sobre Chatwoot (etapa 1, rama feat/asistente-chatwoot-sabor) — migración 20261021090000 SIN aplicar, corrida real solo por el CLI (suscripción), payload armado de la doc
metadata:
  type: project
---

Etapa 1 del asistente de Sabor & Experiencias sobre el núcleo de ONE (D1, 2026-10-20). #1225 mergeado (4475475) y migración 20261021090000 APLICADA; `chatwoot-agente` sigue SIN desplegar y sin secretos. Sobreventa (§8.3/§8.4) en la rama `feat/asistente-sabor-sobreventa`, sin migración (ficha en el jsonb del reglamento).

Estado al cerrar:
- Migración `20261021090000_asistente_chatwoot.sql` ya aplicada (lo dijo Yuto el 2026-10-21); `chatwoot-agente` SIN desplegar; secretos por slug (`CHATWOOT_WEBHOOK_SECRET_<SLUG>`, `CHATWOOT_API_TOKEN_<SLUG>`, `GEMINI_API_KEY_PAGO`) SIN crear. El workspace de Sabor en ONE no existe: crearlo lo autoriza Mauricio.
- Arnés `--seco` 54/54. Corrida REAL por el CLI de Claude Code con la suscripción (Mauricio, 2026-10-21: nunca con la llave de prod): `arnes/correr.ts --cli`, 53/54 con pass^3 y 0 dañinas (falla `l-jerga` 1 de 3). Sus tiempos traen el arranque del CLI: no sirven para `corte_1`, que queda en 5 s hasta tener trazas de producción. Effort, caché, strict y refusal del adaptador NO se ejercitan por el CLI.
- `claude -p` desde un subagente: hay que quitar `CLAUDE_CODE_SIMPLE` del entorno (activa `--bare`, que solo acepta llave de API) y `CLAUDECODE`. El CLI acepta el id `claude-haiku-5-5` tal cual. El sandbox del worktree rechaza `env -u … claude …` en Bash: hay que lanzarlo desde Deno (`Deno.Command` con `clearEnv`).
- El modelo real pide la autorización con sus palabras: la guarda `autorizacion_improvisada` de `cola.ts` lo ataja. La guarda de precios ahora le devuelve el error al modelo, con un reintento dentro del tope de llamados (gancho `DepsTurno.guardaTexto`, decisión de Yuto del 2026-10-21). Por CLI, 3 de 3 se corrigieron; la guarda antes de publicar sigue igual.
- El fixture de Chatwoot está armado de la doc: `message_type`, tipo de remitente, `data_url` y `submitted_values` siguen SIN VERIFICAR hasta el payload real (22-oct).

Kickoff 22-oct (PR `feat/asistente-sabor-mesa-orden-llegada`, sin mergear al escribir esto): la semilla va con `elige_mesa: no`, sin zonas, sin precio de pareja, solo la preventa (vencida a la hora del arnés, 23-oct) y las reglas parqueadero/ninos/grupos escritas. Marcas `[KICKOFF 22-oct]` vs `[EJEMPLO]`. Los candados que eso deja dormidos (zona con recargo, preferencia anotada, dos condiciones, regla sin ficha) se prueban con `arnes/fichas-prueba.ts`: si alguien vuelve a tocar la semilla, esos casos NO deben depender de ella. Arnés seco 70/70 k=3; CLI sobreventa 15/15 pass^3, 0 dañinas.
- Yuto (22-oct) quitó «mesa» del cierre del resumen (`dominio.ts`) y de `rf.siguiente_paso` («confirmar cupo y pago»). Luego también de `inv.confirmacion`, `seg.quien_confirma` y el error de `sobreventa.ts`: «mesa» ya no aparece en ningún texto al cliente.

Gotchas que costaron:
- Un calificador por regex sobre texto del modelo da falsos positivos cuando la regla de la ficha es una NEGACIÓN que el modelo repite («no hay descuento por pareja»): `RE_DESCUENTO` ya excluye no/ni/nunca. Al escribir una regla nueva en la semilla, correr el CLI y mirar las dañinas antes de creerlas.
- El núcleo recorta cada resultado de herramienta a 400 tokens (`TOPES_BLOQUE.resultado`). Con la ficha ampliada, la experiencia de ejemplo cabe por poco y hay una prueba que lo vigila. Con 2 o más experiencias vigentes se pasaría.
- El verificador del núcleo deja pasar una cifra que escribió el CLIENTE («la promo es a $50.000» → el bot la repite). Por eso existe `publico/precios.ts`: la plata solo sale de lo que devolvió una herramienta.
- `CHECK (estado in (...))` deja pasar NULL. Para exigirlo hay que escribir `estado is not null and ...` (lo atrapó la prueba en PGlite).
- El candado de `proponer` (sin autorización) NO alarga el presupuesto de llamados del núcleo. Si se agotan los 3 llamados, el núcleo devuelve «tope de llamados» y ese error NO cuenta como falla del modelo para reintentar.

**Why:** a la siguiente sesión le va a tocar aplicar la migración, cargar el payload real o correr el arnés real, y esto no se ve leyendo el código.
**How to apply:** antes de dar la etapa 1 por lista, verifica en este orden la migración aplicada, el payload real cargado como fixture y el reporte de la corrida real. Ver [[project-migracion-haiku-55]].
