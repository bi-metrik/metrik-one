---
name: wa-bsuid-sin-telefono
description: Bot de WhatsApp y nombres de usuario de Meta — #724 mergeado (77669d0) y wa-webhook SIN redesplegar por mí; qué recibe quien escribe sin teléfono, el envío por `recipient` no verificado en vivo, y el emparejamiento por username que quedó propuesto (requiere migración)
metadata:
  type: project
---

**#724 mergeado el 2026-09-15 (`77669d0`), sin migración.** El deploy de `wa-webhook` lo hace la
sesión principal: **mergear no despliega**, así que hasta que alguien redespliegue, producción
sigue reventando con cualquier remitente sin `from`.

**Why:** un cliente de 4D SOFT (@jglm_28) tiene nombre de usuario de WhatsApp. Desde abril de
2026 Meta manda el BSUID en `messages[].from_user_id` / `contacts[].user_id` y **omite** `from` y
`wa_id` salvo que el número del negocio le haya escrito o recibido algo en 30 días (ventana **por
número del negocio**, no por portfolio) o que esté en la libreta de contactos de Meta. El webhook
hacía `phone = msg.from` y murió en `identifyUser` sin registrar ni avisar. Workaround que se usó:
que el bot le escriba a su teléfono (reabre los 30 días).

**How to apply:**
- La lectura del payload vive en `_shared/wa-webhook-payload.ts` (puro, probado). `extraerEntrante`
  separa `con_telefono` / `sin_telefono` **por tipo**: un mensaje sin teléfono nunca es un
  `IncomingMessage`. Cualquier flujo nuevo indexado por teléfono queda protegido solo si sigue
  consumiendo `IncomingMessage`.
- Sin teléfono → `atenderSinTelefono` (index.ts): `wa_message_log` con el BSUID en `phone` e intent
  `remitente_sin_telefono`, respuesta por BSUID y aviso a `WA_ADMIN_NOTIFY_PHONE`, tope 3 avisos por
  BSUID en 24 h (el segundo mensaje suele traer el número). Textos en `_shared/wa-sin-telefono.ts`.
- Enviar a un BSUID = `recipient` **sin** `to` (si van los dos gana `to`). Helper puro
  `_shared/wa-destino.ts`, sender `sendTextMessageABsuid`. ⚠️ **No verificado en vivo**: la doc usa
  `<API_VERSION>` y no fija mínimo; el bot sigue en `v21.0`. Si Meta lo rechaza queda `rechazado` en
  `wa_envios` y el aviso interno sale igual. Error propio de Meta: `131062` (tipo no admite BSUID).
- Quien escribe sin teléfono **tampoco entra** a Cardumen, Venezuela ni customer service por
  palabra clave: esos flujos están indexados por teléfono.
- **Propuesto y no hecho (requiere migración):** `aceptaciones_terminos.username` + `bsuid`,
  emparejar el pendiente por `lower(username)` con una sola coincidencia y aceptar el toque por
  `bsuid`. El username cambia; la llave estable es el BSUID (se regenera si cambia el número, llega
  como mensaje `system` `user_changed_number` / `user_changed_user_id`).
- La doc se lee en `.md` en inglés: `…/business-scoped-user-ids.md` devuelve texto plano (el HTML en
  español trae la misma información pero ~2,6 MB con el menú).

Relacionado: [[aceptacion-terminos-wa]], [[probar-handler-wa-bot]], [[dedup-contactos-webhook]].
