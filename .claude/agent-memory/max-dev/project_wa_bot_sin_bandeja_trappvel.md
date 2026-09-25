---
name: wa-bot-sin-bandeja-trappvel
description: Verificado 2026-09-25 para el motor de solicitud de viaje de Trappvel — el bot tiene UN número compartido, no guarda el mensaje completo (preview de 100), y funnelchat_eventos es de SOENA y no trae mensajes
metadata:
  type: project
---

Medido el 2026-09-25 (solo lectura) porque el diseño `proyectos/trappvel/clarity/docs/diseno/motor-solicitud-viaje.md` §2 daba por hecho que "el bot ya está y funnelchat_eventos resuelve teléfono → contacto". Las dos premisas son falsas.

**Why:** un brief que construya sobre esas premisas diseña encima de un almacén de mensajes que no existe.

**How to apply:**
- Un solo número para todo el bot (`WHATSAPP_PHONE_NUMBER_ID` global); el workspace sale del teléfono del REMITENTE (`wa_identify_user` sobre `staff.phone_whatsapp`, luego `wa_collaborators`). Ningún workspace tiene número propio.
- `wa_message_log.message_preview` se corta a 100 chars (`_shared/wa-rate-limit.ts`); no hay tabla con el cuerpo completo ni con el media. Las imágenes solo se bajan dentro del flujo de gastos (bucket de soportes); el audio se transcribe y se descarta.
- Un reenviado llega como `text` normal: `MetaMensaje` no lee `context.forwarded`.
- `funnelchat_eventos` = webhook de FunnelChat (CRM de terceros), solo SOENA; el payload trae nombre/teléfono/correo/etiqueta, NO texto de conversación. Último evento 2026-09-01.
- Trappvel al 2026-09-25: 3 staff sin `phone_whatsapp`, 0 wa_collaborators, 0 filas en wa_message_log, módulos `{business:true}`, trial.
- `verifySignature` es async y se llama sin `await` (wa-webhook/index.ts:58): la firma HMAC nunca rechaza. Ver [[aceptacion-terminos-wa]].
