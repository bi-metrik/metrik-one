---
name: aceptacion-terminos-wa
description: Bot de WhatsApp: aceptación de documentos + entrega de la llave de Valida desde Vault (#720 en prod; #722 mergeado con la guía de acceso, wa-webhook lo redespliega la sesión principal); dominios de Valida en conflicto; y la firma HMAC de wa-webhook NO se valida nunca (verifySignature sin await)
metadata:
  type: project
---

## ⚠️ Estado al 2026-09-15 (caducó lo de "sin mergear")

- **#720 en producción** (merge `d1bf219`, migración aplicada, `wa-webhook` desplegado por la sesión principal).
- **#722 mergeado** (`f4e7ef8`, sin migración): la entrega pasa a 2 mensajes (llave sola + guía con URL
  base, header, `POST /api/v1/validate`, `GET /api/v1/cuenta/consumo`, curl sin llave, docs, soporte) y
  se quitó la promesa falsa "en unos minutos les damos acceso a la plataforma". **Mergear no despliega**:
  hasta que alguien redespliegue `wa-webhook`, producción sigue mandando el texto viejo.
- **Dominios de Valida en conflicto, y se eligió la decisión:** `proyectos/metrik/valida/decisions.md`
  (2026-05-13) fija `valida.metrik.com.co` + `api.valida.metrik.com.co`, pero la guía (`app/docs/page.tsx`
  BASE), la OpenAPI (`servers`), Postman y `lib/og.ts` de metrik-valida siguen en `*.valida.metrikone.co`
  (alias del mismo despliegue, los 4 hosts responden igual). **Why:** `metrikone.co` es solo para ONE.
  **How to apply:** en copy hacia clientes usar `metrik.com.co`; el `VALIDA_API_BASE` por defecto del
  código de ONE todavía dice `metrikone.co` (funciona, no se tocó).
- **Máscara:** `vk_` + 6 (≥32 de resto), 4 (16-31), 0 (<16). 6 es prefijo del `api_keys.key_prefix` (12)
  que Valida guarda en claro, así que no revela nada nuevo y sirve para cruzar.
- 4D SOFT (`opera_para_terceros=false`) sin bolsa asignada: `GET /cuenta/consumo` responde 409
  `sin_plan_asignado` hasta que la sesión de Valida cargue la bolsa después de la entrega.

## Historia

**PR #720** (`feat/wa-aceptacion-terminos`, 2026-09-14), **sin mergear por orden del brief** en ese momento.
Migración `20260915040000_aceptaciones_terminos.sql` entonces **sin aplicar** (renumerada: el ledger ya
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
