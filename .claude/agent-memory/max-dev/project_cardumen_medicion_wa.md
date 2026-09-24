---
name: cardumen-medicion-wa
description: Medicion de Cardumen en el numero de ONE (2026-09-24) — intent 'cardumen:<estudio>' en wa_envios y tokens en wa_message_log; origen='cardumen' exige migracion; solo cuenta desde el deploy
metadata:
  type: project
---

Desde el PR de 2026-09-24 (rama `feat/cardumen-medicion-envios-tokens`) todo envio de Cardumen
queda en `wa_envios` con **`origen='bot'` e `intent='cardumen:<estudio>'`**, y cada llamada al
modelo del motor deja fila en `wa_message_log` (modelo, tokens, latencia, mismo intent) **sin
telefono ni texto**. Consulta de medicion: `docs/sql/cardumen-medicion-mensual.sql`.

**Why:** desde el 1-oct-2026 Meta cobra los mensajes de servicio pasadas 1.000/mes por numero
([[cardumen-infra-independiente]]), y Cardumen comparte el numero con ONE. Antes sus envios
tenian intent null y no se podian separar.

**How to apply:**
- `origen='cardumen'` NO se uso: el CHECK de `wa_envios.origen` solo admite bot/alerta/template/
  interno/desconocido, y supabase-js no lanza al violarlo (la fila se perdia sin rastro; ahora
  `registrarEnvio` al menos lo escribe en consola). Cambiarlo es migracion.
- Sin telefono en `wa_message_log` a proposito: `checkInboundLimit` cuenta filas `inbound` por
  telefono y le restaria cupo al bot de ONE. Las conversaciones se cuentan en `wa_envios`.
- La columna `gemini_model` guarda tambien `claude-haiku-4-5` (motor R1/R2); el lector de
  Navigate es `gemini-3.1-flash-lite`.
- Fuera de la medicion: transcripcion de audios (`wa-transcribe.ts` no devuelve uso) y Voz de
  Venezuela (`_shared/venezuela/`, otro motor en el mismo numero, sin marca).
- **Inerte hasta desplegar `wa-webhook` y `cardumen-cron`**; la data previa no es separable.
