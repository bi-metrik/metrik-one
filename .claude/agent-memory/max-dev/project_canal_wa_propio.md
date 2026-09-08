---
name: canal-wa-propio
description: Estado del canal WhatsApp propio de MeTRIK — webhook wa-canal-propio construido (PR #448), pendientes secrets/deploy/suscripcion/Gate 0
metadata:
  type: project
---

El webhook `supabase/functions/wa-canal-propio/` existe desde el PR #448 (squash `3d40236`, 2026-08-31): GET handshake + firma HMAC + telemetria sin cuerpos. **No esta desplegado ni suscrito en Meta.**

**Why:** el numero corporativo de MeTRIK entra a Cloud API via Coexistence en una app de Meta DEDICADA, separada del bot (decision 6 de `docs/specs/2026-08-20_canal-whatsapp-propio-metrik.md`). Lleva conversaciones personales de Mauricio: el Gate 0 (regla de ingesta de Emilio) bloquea toda persistencia, y la mitad tecnica del gate es no suscribir `history` ni `smb_message_echoes`.

**How to apply:**
- Secretos que Mauricio debe setear antes del deploy: `WA_CANAL_PROPIO_VERIFY_TOKEN` y `WA_CANAL_PROPIO_APP_SECRET`. Deploy con `--no-verify-jwt` (ya declarado en `config.toml`).
- El punto de extension para cuando exista el Gate 0 es `procesarEventoValido()` — hoy es no-op deliberado. NO persistir contenido de mensajes hasta que Emilio firme la regla.
- Decisiones tomadas en el #448 que no estan en la spec: sin bypass de dev para la firma (sin secreto se rechaza todo), hash del wa_id con HMAC llaveado por el app secret (no SHA-256 pelado), statuses tambien en telemetria, JSON malformado con firma valida responde 200.
- La suscripcion en Meta es de Yuto (`fields=messages` y nada mas, esquivando el panel bloqueado). Los alcances A (responder desde sesion), B (clasificador sombra), C (match contacto/negocio) y D (catalogo) vienen despues, en ese orden.
- PROHIBIDO copiar el patron de `funnelchat/route.ts` (loguea body antes de validar) y prohibido cualquier cuerpo de mensaje en logs, ni truncado.
