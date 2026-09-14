---
name: aceptacion-terminos-wa
description: PR #720 sin mergear — aceptación de documentos por el bot de WhatsApp (tabla aceptaciones_terminos SIN aplicar, wa-webhook SIN desplegar); y la firma HMAC de wa-webhook NO se valida nunca (verifySignature sin await)
metadata:
  type: project
---

**PR #720** (`feat/wa-aceptacion-terminos`, 2026-09-14), checks verdes, **sin mergear por orden
del brief**. Migración `20260914235500_aceptaciones_terminos.sql` **sin aplicar** y `wa-webhook`
**sin desplegar**. Caso que lo pidió: 4D SOFT (negocio `X1 26 1`, workspace metrik), Bayron
Correa `+573164509919`, que NO está en `staff` ni `wa_collaborators` (cae por desconocidos).

**Why:** hacía falta constancia de QUÉ texto y QUÉ archivo aceptó alguien y CUÁNDO. La
evidencia es: `texto_aceptacion` exacto, `documento_sha256` **verificado al descargar** (si no
coincide no se envía nada), `payload_respuesta` con el cuerpo crudo del webhook **y su firma**
(re-serializar el JSON rompe la verificación HMAC posterior), y `respondido_at` = timestamp de Meta.

**How to apply:**
- Orden a producción: migración → verificación de `relacl`/`has_table_privilege` (consultas en la
  cabecera del archivo) → merge → deploy `--no-verify-jwt` desde extracto limpio → confirmar
  `WA_ADMIN_NOTIFY_PHONE` → Mauricio le escribe al bot (el aviso sale como texto libre y sin
  ventana de 24 h Meta lo rechaza con 131047) → crear la fila pendiente.
- Decisiones que no son obvias leyendo el código: un número **registrado** con pendiente recibe
  documento/recordatorio pero su mensaje **sigue** al flujo normal; la **primera respuesta vale**
  (el trigger congela filas respondidas y lo mostrado desde `enviado_at`); `expirado` es perezoso,
  sin cron; recordatorio máx. cada 10 min con **reclamo atómico** sobre `ultimo_intento_at` (dos
  webhooks casi simultáneos duplicaban el documento); pausa de 3 s entre documento y botones
  porque Meta descarga el link y el orden no está garantizado.
- La lógica pura vive en `_shared/aceptacion-terminos.ts` (41 pruebas); el flujo en
  `aceptacion-terminos-flujo.ts`. `sendButtons` ahora devuelve el wamid.

## ⚠️⚠️ La firma HMAC de wa-webhook no se valida nunca (preexistente, NO corregido)

`verifySignature` es `async` y `Deno.serve` hace `if (!verifySignature(body, signature))` **sin
await**: una Promise es truthy, así que ningún POST se rechaza. Cuadra con lo que registró la sesión
del 2026-06-10 ("POST vacío → 200"). **No arreglarlo a ciegas:** si `WHATSAPP_APP_SECRET` de
producción está mal o falta, el `await` tumba el bot entero (401 a Meta). Primero confirmar el
secreto, luego PR aparte.

## Datos de producción que parecen raros (medidos por PostgREST, sin tocar)
- Cero filas `intent = numero_desconocido` en `wa_message_log` y en `wa_envios`: la rama de
  desconocidos (log + aviso al admin) no tiene NI UNA ejecución observada.
- El contacto del negocio `X1 26 1` es Yessica Vasquez (AFI), no Bayron.

## Método: validar plpgsql sin base con pglast 8.4
`parse_plpgsql_json` devuelve JSON **inválido** en funciones de trigger (`{}}` por las variables
`tg_*`): `.replace("{}}", "{}")` antes de `json.loads`. Comprobado que igual detecta un cuerpo roto.
