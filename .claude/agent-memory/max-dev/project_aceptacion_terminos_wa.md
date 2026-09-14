---
name: aceptacion-terminos-wa
description: PR #720 sin mergear — aceptación de documentos por el bot de WhatsApp + entrega de la llave de Valida desde Vault (migración SIN aplicar, wa-webhook SIN desplegar); y la firma HMAC de wa-webhook NO se valida nunca (verifySignature sin await)
metadata:
  type: project
---

**PR #720** (`feat/wa-aceptacion-terminos`, 2026-09-14), **sin mergear por orden del brief**.
Migración `20260915040000_aceptaciones_terminos.sql` **sin aplicar** (renumerada: el ledger ya
tenía `20260915020000` de #719) y `wa-webhook` **sin desplegar**. Caso que lo pidió: 4D SOFT
(negocio `X1 26 1`, workspace metrik), Bayron Correa `+573164509919`, que NO está en `staff` ni
`wa_collaborators` (cae por la rama de desconocidos).

**Why:** hacía falta constancia de QUÉ texto y QUÉ archivo aceptó alguien y CUÁNDO, y entregarle
al cliente su llave de API de Valida por el mismo chat sin dejarla en claro en ninguna tabla.
Evidencia: `texto_aceptacion` exacto, `documento_sha256` **verificado al descargar** (si no
coincide no se envía nada), `payload_respuesta` con el cuerpo crudo del webhook **y su firma**
(re-serializar el JSON rompe la verificación HMAC posterior), `respondido_at` = timestamp de Meta.

**How to apply:**
- Orden a producción: migración → verificación de grants (consultas en la cabecera) → merge →
  deploy `--no-verify-jwt` desde extracto limpio → confirmar `WA_ADMIN_NOTIFY_PHONE` → Mauricio le
  escribe al bot (el aviso sale como texto libre; sin ventana de 24 h Meta lo rechaza con 131047)
  → fila pendiente → `vault.create_secret('<LLAVE>', ...)` → fila en `aceptaciones_terminos_acciones`.
- Decisiones no obvias: un número **registrado** con pendiente recibe documento/recordatorio pero
  su mensaje **sigue** al flujo normal; la **primera respuesta vale**; `expirado` es perezoso;
  recordatorio máx. cada 10 min con **reclamo atómico** sobre `ultimo_intento_at`; pausa de 3 s
  entre documento y botones (Meta descarga el link y el orden no está garantizado).
- Acciones post-aceptación: corren SOLO en el UPDATE que ganó (un reintento de Meta cae en
  `duplicado` antes), con segundo candado `intentado_at`. `fallida` no se reintenta y deja la llave
  en Vault. `enviar_acceso_portal` está modelada y sin envío: el portal de Valida no existe aún.
  **El flujo NO verifica el pago en Bold.**
- La llave sale por `sendTextoExacto` (sin `aEspanolNeutro` ni split: el guard reescribe tramos
  entre `_` y los imprime) con `EnvioCtx.preview` enmascarado (`vk_ab12…`) para `wa_envios`.
- Vault en ONE: `supabase_vault` 0.3.1, patrón de RPC `security definer` + `search_path = ''` +
  revoke nombrando roles + grant a `service_role` (lo estableció #717, `leer_secretos_workspace`).

## ⚠️⚠️ La firma HMAC de wa-webhook no se valida nunca (preexistente, NO corregido)

`verifySignature` es `async` y `Deno.serve` hace `if (!verifySignature(body, signature))` **sin
await**: una Promise es truthy, así que ningún POST se rechaza. Cuadra con lo que registró la sesión
del 2026-06-10 ("POST vacío → 200"). **No arreglarlo a ciegas:** si `WHATSAPP_APP_SECRET` de
producción está mal o falta, el `await` tumba el bot entero (401 a Meta). Primero confirmar el
secreto, luego PR aparte.

## Datos de producción que parecen raros (medidos, sin tocar)
- Cero filas `intent = numero_desconocido` en `wa_message_log` y en `wa_envios`: la rama de
  desconocidos (log + aviso al admin) no tiene NI UNA ejecución observada.
- El contacto del negocio `X1 26 1` es Yessica Vasquez (AFI), no Bayron.

## Método
- **Validar plpgsql sin base con pglast 8.4:** `parse_plpgsql_json` devuelve JSON **inválido** en
  funciones de trigger (`{}}` por las variables `tg_*`): `.replace("{}}", "{}")` antes de
  `json.loads`. Comprobado que igual detecta un cuerpo roto.
- **Consulta de solo lectura por Management API desde el worktree pasó** con `"read_only": true`
  en el body y el `sbp_` sacado por regex sin imprimirlo (script escrito con Write, borrado después).
