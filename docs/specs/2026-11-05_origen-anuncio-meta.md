# Origen del anuncio de Meta: captura del `referral` (Fase A) y diseño de `meta-origen` (Fase B)

Fecha: 2026-11-05 · Encargo: `max-agus-origen-anuncio` (recomendación 7 del informe de arquitectura de agentes conversacionales) · Ejecuta: Max

## En lenguaje llano

Cuando alguien toca un anuncio de Meta y escribe, Meta dice de qué anuncio viene, pero **solo en ese primer mensaje**. Hasta hoy nadie guardaba ese dato, así que se perdía.

Desde este PR:

- **WhatsApp** (el número de Agus, y cualquier número de WhatsApp conectado a Chatwoot) guarda el anuncio, el `ctwa_clid` y el JSON completo que manda Meta.
- Si después se crea el contacto con ese teléfono, el contacto queda marcado como `anuncio_meta`, y su negocio nace con origen `meta`. Solo se llenan campos vacíos: nunca se pisa lo que alguien declaró.
- **Messenger e Instagram por Chatwoot (el caso de Dimpro):** Chatwoot **no** nos pasa el dato del anuncio. Está comprobado en su código y en una conversación real de Dimpro. Para recuperarlo hace falta la Fase B, una función nuestra conectada directo a Meta. Abajo queda diseñada, sin construir.
- **Chatwoot ya distingue Messenger.** Hasta hoy, las 206 filas de Dimpro decían canal `'otro'` porque el código no sabía qué era `Channel::FacebookPage`. Las filas nuevas dirán `'messenger'`. Las viejas no se tocan: cambiarlas sería escribir en Dimpro.

## Evidencia: qué trae Chatwoot (2026-11-05)

### 1. El inbox de Dimpro es Messenger

Lectura por la API de Chatwoot de la cuenta 189134, sin escribir nada:

| inbox | nombre | channel_type |
|---|---|---|
| 151556 | Ingeniería Dimpro | `Channel::FacebookPage` |
| 142507 | metrik | `Channel::WebWidget` |
| 142511 | Prueba API (simula Instagram) | `Channel::Api` |

`canalDeChatwoot` solo reconocía instagram, tiktok y whatsapp. Messenger caía en `'otro'`, y la configuración del inbox en `config_extra` también dice `'otro'`.

### 2. Un payload real de Messenger no trae `referral`

Primer mensaje entrante de la conversación 3, con los datos personales enmascarados (`***`):

```json
{
  "conversation": { "id": 3, "channel": "Channel::FacebookPage", "additional_attributes": {}, "custom_attributes": {} },
  "contact": { "additional_attributes": { "avatar_url_hash": "***", "last_avatar_sync_at": "2026-10-29T21:54:03Z" }, "custom_attributes": {}, "identifier": null },
  "first_incoming": {
    "id": 960878790, "message_type": 0, "content_type": "text", "content": "***",
    "content_attributes": { "in_reply_to_external_id": null },
    "source_id": "***"
  }
}
```

Revisé las 9 conversaciones del inbox que devuelve la API: ninguna trae `referral`, ni en el mensaje ni en la conversación ni en el contacto. Las únicas llaves que aparecen son `in_reply_to_external_id` en el mensaje y `avatar_url_hash` y `last_avatar_sync_at` en el contacto.

### 3. El código de Chatwoot confirma la causa (repo `chatwoot/chatwoot`, rama por defecto)

- **WhatsApp Cloud sí lo copia.** En `app/services/whatsapp/incoming_message_service_helpers.rb#referral_attributes`, `message[:referral]` se guarda crudo en `content_attributes.referral` (`incoming_message_base_service.rb:182`), y ese campo viaja en el webhook `message_created`. Eso es lo que lee `toqueDeChatwoot`.
- **Messenger no.** En `app/models/channel/facebook_page.rb#subscribe` la página se suscribe solo a `messages message_deliveries message_echoes message_reads standby messaging_handovers messaging_postbacks`, **sin `messaging_referrals`**. Además, `lib/integrations/facebook/message_parser.rb` no lee `message.referral`.
- **Instagram no.** En `app/models/channel/instagram.rb#subscribe` la suscripción es solo a `messages message_reactions messaging_seen`.

Conclusión: para WhatsApp alcanza con la Fase A. Para Messenger e Instagram, que es Dimpro, hace falta la Fase B.

## Fase A (este PR)

| Pieza | Qué hace |
|---|---|
| `supabase/migrations/20261105231500_origen_anuncio_meta.sql` | Crea `origen_toques`, con el primer toque inmutable y único por (canal, alcance, persona), los toques siguientes como filas aparte, el JSON crudo, RLS, server-only y la guarda MK002. Crea `origen_canales`, que dice qué número, página o cuenta es de qué empresa. Crea la RPC `registrar_toque_origen`, idempotente por mensaje. Agrega los disparadores de origen al contacto y al negocio. Suma `'anuncio_meta'` al CHECK de `contactos.origen_tipo` y `'messenger'` al de `chatwoot_conversacion.canal`. |
| `_shared/origen-anuncio.ts` | Lectores puros para WhatsApp, Messenger e Instagram (en `messaging` y `standby`) y Chatwoot. Incluye `grabarToques`, que nunca lanza. |
| `wa-webhook` | Graba el toque al recibir el webhook, antes de cualquier otra lógica y aunque el remitente no esté registrado. Lo hace en segundo plano, así que un fallo no toca la respuesta. |
| `chatwoot-agente` | Graba el toque antes de los filtros, con la empresa del `?ws=`. Si grabar falla, el mensaje sigue igual. Reconoce `Channel::FacebookPage` como `'messenger'`. |
| Compatibilidad | `toquesPorTitulo`, el botón de Messenger que llega como texto, sigue valiendo con `'messenger'` y también con `'otro'`. `funcion_apartar`, la reserva de Sabor, recibe `'otro'` cuando el canal es `'messenger'`, igual que antes. |

**Alcance.** Meta emite el id de la persona por alcance: el wa_id por número, el PSID por página y el IGSID por cuenta. Por eso el primer toque es único por `(canal, alcance, id_externo)`.

- `wa-webhook` usa el `phone_number_id` como alcance.
- `chatwoot-agente` usa `cw:<cuenta>:<inbox>`, porque el payload de Chatwoot no trae el `phone_number_id`.

**Empresa del toque.**

- `chatwoot-agente` la toma del `?ws=`.
- `wa-webhook` la busca en `origen_canales`. Si no encuentra fila, guarda el toque igual con `workspace_id` nulo, y la empresa se le asigna después, una sola vez. Perder el dato es peor que guardarlo sin dueño.

**Vínculo con el contacto.**

- En WhatsApp va por teléfono. La comparación usa solo dígitos, y un celular colombiano de 10 dígitos gana el 57 para compararse con el wa_id. Si hay dos contactos con el mismo teléfono, no se adivina.
- En Messenger e Instagram no hay teléfono. El vínculo llegará con la Fase B: quien cree el contacto desde la conversación pasa el PSID o IGSID.

### Pasos para salir a producción

1. **Visto de Mauricio a la migración.** El ensayo en seco salió bien el 2026-11-05: el archivo real corrió dentro de un `DO … EXECUTE … RAISE` por la Management API, se ejecutó el primer toque, el segundo, la idempotencia y la inmutabilidad, y nada quedó escrito. La migración es aditiva y no cambia filas existentes.
2. **Aplicar antes del merge**, porque el merge despliega solo. Se aplica por la Management API más el `INSERT` en `supabase_migrations.schema_migrations` con `('20261105231500', 'origen_anuncio_meta')`.
3. **Merge del PR.**
4. **Desplegar las dos funciones.** Lo corre Mauricio:
   ```bash
   supabase functions deploy wa-webhook --project-ref yfjqscvvxetobiidnepa --use-api --no-verify-jwt
   supabase functions deploy chatwoot-agente --project-ref yfjqscvvxetobiidnepa --use-api --no-verify-jwt
   ```
5. **Opcional, para ordenar Dimpro.** Requiere la frase "autorizo escribir en dimpro":
   - en `config_extra.bot_conversacional.chatwoot.inboxes`, poner `canal: 'messenger'` al inbox 151556. Desde este PR no hace falta, porque el código ya lo deduce de `Channel::FacebookPage`;
   - pasar las 206 filas viejas de `chatwoot_conversacion` de `'otro'` a `'messenger'`.
6. **Opcional.** Agregar una fila en `origen_canales` para el `phone_number_id` del número de Agus, con la empresa a la que se le atribuyen sus anuncios. Mientras no exista, los toques de ese número quedan sin empresa, pero quedan guardados.

## Fase B: `meta-origen` (diseñada, NO construida; se construye con visto de Mauricio)

### Qué es

Una edge function nueva, `supabase/functions/meta-origen`, suscrita **directamente** a los webhooks de Meta con una app de Meta de MéTRIK, en paralelo a Chatwoot.

- **Solo graba el toque. Nunca responde ni envía nada.**
- Chatwoot sigue siendo quien atiende la conversación.

### Qué escucha

| Producto | Objeto | Campos de suscripción | Dónde viene el `referral` |
|---|---|---|---|
| Messenger (página de Dimpro) | `page` | `messages`, `messaging_referrals`, `messaging_postbacks` (y llega `standby` si Chatwoot tiene el control de la conversación) | `message.referral`, `referral`, `postback.referral` |
| Instagram | `instagram` | `messages` y el de referidos (nombre exacto a confirmar en la doc de Meta) | `message.referral`, `referral` |
| WhatsApp de números propios que no pasan por Chatwoot ni son Agus | `whatsapp_business_account` | `messages` | `messages[].referral` |

### Cómo funciona

1. `GET`: hace el handshake (`hub.mode=subscribe`, `hub.verify_token` contra `META_ORIGEN_VERIFY_TOKEN`) y devuelve `hub.challenge`.
2. `POST`: valida `X-Hub-Signature-256` con un HMAC-SHA256 del cuerpo crudo y `META_ORIGEN_APP_SECRET`, con comparación en tiempo constante. **Sin secreto, rechaza** (falla cerrado, como `wa-firma.ts`).
3. Responde `200` de inmediato y deja el trabajo en `EdgeRuntime.waitUntil`.
4. Lee los toques:
   - `toquesDePagina(payload)` para `page` e `instagram`. Ya está construida y probada en este PR, incluido `standby`;
   - `toquesDeWhatsapp(payload)` para `whatsapp_business_account`.
5. Resuelve la empresa por `origen_canales (canal, alcance)`: `page_id`, id de la cuenta de IG o `phone_number_id`. Sin fila, el toque se graba con `workspace_id` nulo.
6. Llama `grabarToques(supabase, toques, 'meta-origen')`. Ya existe, y la fuente `'meta-origen'` ya está permitida por el CHECK.
7. No registra el cuerpo del mensaje en los logs, ni siquiera truncado. Solo registra canal, alcance y si grabó o no.

### Lo que falta construir

- El `index.ts` de `meta-origen`, que es corto y reutiliza `_shared/origen-anuncio.ts`.
- Unir Chatwoot con el PSID: cuando la conversación de Chatwoot cree un contacto, pasar `conversation.contact_inbox.source_id` (el PSID o IGSID) para vincular el toque. El alcance tiene que coincidir: `meta-origen` usa el `page_id`, y Chatwoot hoy no lo manda en el webhook. Se resuelve una vez leyendo el inbox por la API de Chatwoot (`GET /inboxes/:id` trae el `page_id`) y guardándolo en la configuración del inbox.
- Pruebas de la función con payloads firmados.

### Pasos en Meta (los hace Mauricio en el navegador)

> Los permisos y el tipo de acceso se confirman en la documentación oficial de Meta al momento de configurarlo. No se dan por sabidos.

1. **App.** En developers.facebook.com, usar o crear la app de MéTRIK, tipo Business, en el Business Manager de MéTRIK, y agregar el producto **Messenger** (y **Instagram** si aplica).
2. **Secretos en Supabase:**
   - `META_ORIGEN_APP_SECRET`: el *App Secret* de la app, en Configuración › Básica;
   - `META_ORIGEN_VERIFY_TOKEN`: una cadena aleatoria que elija Mauricio.
3. **Webhook.** En Messenger › Configuración › Webhooks:
   - URL de callback: `https://yfjqscvvxetobiidnepa.supabase.co/functions/v1/meta-origen`;
   - token de verificación: el mismo `META_ORIGEN_VERIFY_TOKEN`;
   - campos: `messages`, `messaging_referrals`, `messaging_postbacks`.
4. **Conectar la página de Dimpro** (la del inbox "Ingeniería Dimpro"): en Messenger › Configuración › Tokens de acceso, agregar la página y generar el token. Mauricio necesita un rol en la página, o MéTRIK tiene que ser socio en el Business de Dimpro. Al agregarla, la página queda suscrita a la app (`/{page-id}/subscribed_apps`). **No hay que quitar a Chatwoot**: una página admite varias apps suscritas.
5. **Permisos.** Revisar en la documentación si alcanza el acceso estándar de `pages_messaging` y `pages_manage_metadata` para una página que administra un usuario con rol en la app, o si hace falta la revisión de la app.
6. **Instagram**, si Dimpro lo quiere: los mismos pasos en Instagram › Webhooks, con el campo `messages` y el de referidos que indique la doc, y la cuenta de IG vinculada a la página.
7. **Prueba.** Hacer clic en un anuncio de Dimpro que lleve a Messenger y escribir. En `origen_toques` debe aparecer una fila `canal = 'messenger'` con el `ad_id`.
   - Si la fila no aparece, mirar los logs de `meta-origen`.
   - Si Chatwoot tiene el control de la conversación, el evento llega como `standby`, que ya se lee.
8. **Registrar la página** en `origen_canales` con `canal = 'messenger'`, `alcance = <page_id>` y la empresa de Dimpro. Es una escritura en Dimpro y necesita su frase.

### Riesgo y reversa

- La función no responde, así que no puede duplicar mensajes ni pelear el control de la conversación con Chatwoot.
- Para apagarla, se quita la suscripción de la página en la app de Meta, o se borra la función. No afecta a Chatwoot.
