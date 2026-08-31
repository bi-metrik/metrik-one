# Spec — Canal WhatsApp propio: conectar el número corporativo de MéTRIK a ONE

**Co-owners:** Max (código ONE) + **Yuto (capa conversacional y todo lo que toca a Meta)**
**Privacidad y Habeas Data:** Emilio (Gate 0, bloqueante) · **Herramienta en `.claude/`:** Mik
**Origen:** sesión 2026-08-20 con Mauricio. Decisión: **probar en casa lo que después vendemos.**

Conectamos el WhatsApp de MéTRIK a ONE, no el de un cliente. Cero riesgo comercial
ajeno, tráfico real, y lo que salga de aquí es el producto — no una demo.

⚠️ **Esto NO es construir un FunnelChat.** No hay bandeja multi-agente en este alcance.
El canal es una **fuente de eventos del negocio**: entra un mensaje, se interpreta, y
dispara algo dentro de ONE. La bandeja es otra spec y va después, si duele no tenerla.

## Decisiones tomadas (no reabrir sin decisión de Mauricio)

1. **El número es el corporativo de MéTRIK** (+57 315 950 9103), vía **Coexistence**:
   sigue funcionando en la app del celular y además queda en Cloud API. No se migra
   nada, no se pierde el uso diario.
2. **Gate 0 es la regla de ingesta, no el código.** Ese número lleva conversaciones
   personales de Mauricio. Antes del primer mensaje ingerido hay que declarar por
   escrito qué se guarda y qué se descarta. Sin esa regla firmada, no se conecta.
3. **El portafolio (Catalog API) se construye como demo vendible, no como necesidad
   propia.** MéTRIK no vende productos de catálogo. Entra al alcance porque el cliente
   que sí vende lo va a pedir, y probarlo en casa es gratis.
4. **Opt-in doble obligatorio** para cualquier saliente proactivo — Habeas Data
   (Ley 1581) + opt-in Meta son dos cosas distintas. Ver `cerebro/reglas/wa-opt-in-doble-compliance.md`.
5. **Nada de esto toca a SOENA ni a ningún cliente en este alcance.**
6. **El número corporativo va en WABA y app de Meta SEPARADAS del bot.** Corrección de
   Mauricio (2026-08-20): el número del bot y el que vamos a absorber no son el mismo,
   y no deben compartir configuración. Razón técnica: **las suscripciones de campos del
   webhook son por app/WABA, no por número.** En una app compartida no se puede tener
   `history` y `smb_message_echoes` apagados para el número personal y a la vez la
   configuración que le convenga al bot — es una sola. Separarlos da tres cosas:
   aislamiento de privacidad, webhook propio (el tráfico personal nunca entra al código
   que atiende clientes) y radio de daño acotado (la prueba no puede tumbar Cardumen ni
   el bot de servicio). Costo: una app más que configurar, con su Tech Provider propio.

## Lo que ya existe en ONE (no se construye de nuevo)

| Pieza | Dónde | Qué aporta |
|---|---|---|
| Webhook entrante | `supabase/functions/wa-webhook/` | Recibe de Meta, identifica quién escribe, rutea por intención |
| Parser de intención | `_shared/wa-parse.ts` | Clasifica el texto; telemetría de parseo incluida |
| Transcripción de audio | `_shared/wa-transcribe.ts` | Las notas de voz entran como texto |
| Sesión conversacional | `_shared/wa-session.ts` | Hilo por teléfono, expiración a 24h, tope de turnos |
| Envío | `_shared/wa-respond.ts` | Texto, botones, CTA con URL, ritmo humano |
| Envío desde servicios internos | `wa-notify-internal/` | POST con secreto compartido. **Base del alcance A** |
| Bot de cliente | `_shared/customer/` | Resuelve quién escribe contra contactos + negocios + etapas; escala a llamada |
| Rate limit y bitácora | `_shared/wa-rate-limit.ts` | Tope entrante/saliente, `logMessage` |
| Alertas proactivas | `wa-alerts/` | Cron saliente ya operando |
| Motor de reglas | `evaluar-reglas/` | **Destino natural de los triggers** |
| App Meta + system user + token permanente | `.credentials.md` §WhatsApp | App "Metrik ONE" ya creada y verificada |

Traducción: el canal ya existe y corre en producción. Esta spec **no lo construye — lo apunta al número corporativo y le agrega cuatro capacidades.**

## Reparto de owners

Este canal tiene dos mitades y **ninguna es subordinada de la otra**. Yuto entra desde
el paso 1, no desde el paso 3: casi todo lo que decide si esto funciona vive de su lado.

| Frente | Owner | Qué decide |
|---|---|---|
| Activación de Coexistence ante Meta | **Yuto** | Ejecuta el alta del número, verifica que el celular sobrevive |
| Ventana de 24h, plantillas, opt-in | **Yuto** | Qué se puede enviar y cuándo; redacta y somete plantillas |
| Elección de modelo y costo por conversación | **Yuto** | Modelo económico con naturalidad suficiente; mide el costo |
| Prompts del clasificador y del extractor | **Yuto** | El texto que define las tres clases y los campos de perfil |
| Mitad técnica del Gate 0 | **Yuto** | Qué manda Meta realmente y qué se puede descartar en el borde, antes de tocar disco |
| Código en `metrik-one/` | **Max** | Webhook, esquema de datos, persistencia, bitácora |
| Match contacto / negocio y escritura en ONE | **Max** | Las tres ramas de la clasificación lead/cliente |
| Triggers a `evaluar-reglas` | **Max** | Qué evento mueve qué en el negocio |
| Criterio legal de ingesta | **Emilio** | Gate 0. Bloquea todo lo demás |
| Herramienta de respuesta desde la sesión | **Mik** | Vive en `.claude/`, fuera del producto |

Regla de borde entre Max y Yuto: **si el mensaje todavía no tocó nuestra base de datos,
es de Yuto. Desde que se persiste, es mío.**

## Gate 0 — Regla de ingesta (bloqueante)

Coexistence sincroniza **todos** los chats 1:1 del número, incluidos los personales.
Hay que decidir y escribir, antes de conectar:

- Qué conversaciones se persisten y cuáles se descartan al vuelo (propuesta: solo se
  persiste el hilo cuyo teléfono hace match contra `contactos`, o que el clasificador
  marque como comercial; el resto se descarta sin escribir a disco).
- Qué se guarda del hilo: ¿texto completo, o solo los campos extraídos y un resumen?
- Retención: cuánto vive un hilo persistido.
- Quién puede leerlo dentro de ONE (rol mínimo).
- Qué pasa con el histórico de 6 meses que Coexistence sincroniza al activarse:
  **propuesta por defecto — no se ingiere nada previo a la activación.**

Revisa Emilio. Sin su visto bueno el resto no arranca.

## Alcance

### A. Responder desde Claude Code — complejidad baja

Un envoltorio invocable desde la sesión que llame a `wa-notify-internal`. Vive en
`.claude/` (owner Mik), no en el producto.

- Requisito: el destinatario debe estar **dentro de la ventana de servicio de 24h**.
  Fuera de ella, Meta solo acepta plantillas aprobadas — no texto libre. La herramienta
  debe decir cuál es el caso antes de intentar, no fallar con un error de Meta.
- Todo saliente se registra con autor (`claude-code`) y queda en la bitácora.
- Guardarraíl: confirmación explícita antes de cada envío a un tercero. Un mensaje de
  WhatsApp no se puede deshacer, y con Coexistence tampoco se puede revocar.

### B. Triage de entrantes — complejidad media

Clasificador sobre el mensaje ya parseado y transcrito. Tres salidas:

| Clase | Qué significa | Qué dispara |
|---|---|---|
| `seguimiento` | Avanza algo que ya existe | Evento en el timeline del contacto/negocio |
| `requiere_accion` | MéTRIK debe hacer algo | Entra a la cola de pendientes con el qué y el para cuándo |
| `informativo` | No exige nada | Se registra y no molesta a nadie |

- El clasificador **propone, no ejecuta**. Nada se escribe en un negocio sin
  confirmación humana. Es la misma regla del extractor de perfil.
- Modelo: económico con naturalidad suficiente (Yuto decide; el bot de cliente ya
  corre sobre `gemini-2.5-flash`).
- Se mide: tasa de acierto por clase sobre tráfico real, antes de conectar triggers.

### C. Lead vs cliente, atado a contacto y negocio — complejidad media

El alcance de mayor valor y el que más avanzado está.

- Match por teléfono contra `contactos`. Tres casos:
  - **Existe con negocio activo** → cliente. El hilo cuelga del negocio.
  - **Existe sin negocio** → lead conocido. El hilo cuelga del contacto.
  - **No existe** → lead nuevo. Se crea el contacto con lo que se pueda extraer,
    marcado como origen WhatsApp y pendiente de confirmación.
- Enriquecimiento de perfil: al cerrar el hilo, un extractor propone campos
  (necesidad, presupuesto, urgencia, objeción, quién decide). **Propone. No escribe.**
- Esto es lo que en SOENA sería el punto 58/59 — la conversación como evidencia
  colgada del negocio. Aquí se prueba sin tocar a SOENA.

### D. Portafolio en WhatsApp Business — complejidad baja

Catalog API: crear, actualizar y borrar ítems del catálogo desde ONE o desde la sesión.

- Requiere catálogo creado en Commerce Manager y vinculado al WABA.
- Valor real: es **demo vendible** para clientes que venden productos. Para MéTRIK es
  un ejercicio. No bloquear A, B ni C por esto.

## Lo que NO entra en este alcance

- Bandeja multi-agente en tiempo real (asignación, presencia, hilos compartidos).
- Conectar el número de un cliente. Eso es Embedded Signup + Tech Provider, y es la
  spec siguiente.
- Migrar cualquier número que hoy viva en FunnelChat.
- Campañas o envíos masivos.

## Requisitos ante Meta

| Requisito | Estado |
|---|---|
| Verificación de negocio METRIK IA S.A.S. | ✅ hecha para Cardumen. Cubre el Business Manager, sirve para las dos apps |
| App del bot (`MéTRIK Gastos Bot`, `1253195210021140`) | ✅ existe y corre — **no se toca en este alcance** |
| App de Meta **nueva y dedicada** al número corporativo | ⬜ crear. No reusar la del bot (decisión 6) |
| WABA separada bajo el mismo Business Manager | ⬜ crear |
| Webhook propio de esa app, aparte de `wa-webhook` | ⬜ construir — owner Max |
| Tech Provider + Embedded Signup con session logging **en la app nueva** | ⬜ prerequisito duro de Coexistence |
| App WhatsApp Business ≥ 2.24.17 en el celular | ⬜ verificar |
| Activar Coexistence sobre el número corporativo | ⬜ pendiente |
| Meta Verified | ⬜ **no verificado** — la doc oficial de Coexistence no lo menciona. Sale de blogs de vendors. Confirmar contra el rate card antes de presupuestarlo |
| Plantillas aprobadas para fuera de la ventana de 24h | ⬜ según lo que salga de B |
| Catálogo en Commerce Manager vinculado al WABA | ⬜ solo para D |

## Dimensionamiento Yuto — capa conversacional y Meta

Consultado contra docs oficiales el 2026-08-20 (Meta for Developers, ai.google.dev,
platform.claude.com). Nada de esto es de memoria.

### 0. Estado verificado del lado Meta (2026-08-20, Graph API, solo lectura)

| Hallazgo | Detalle |
|---|---|
| Token del bot | Válido, permanente, system user "Métrik Bot" |
| Nombre real de la app | **"MéTRIK Gastos Bot"** (`1253195210021140`). `.credentials.md` la llama "Metrik ONE" — discrepancia a corregir por Kaori |
| Permisos otorgados | `whatsapp_business_management`, `whatsapp_business_messaging`, `whatsapp_business_manage_events`, `manage_app_solution`, `ads_read`, `leads_retrieval`, `pages_*` |
| ⚠️ Falta | **`business_management`**. No estorba para el número propio; sí hace falta para onboardear números de clientes por Embedded Signup (spec siguiente) |
| No verificable por API | Las suscripciones de campos exigen **App Secret**; Tech Provider y session logging solo se ven en el App Dashboard |

Con la decisión 6 nada de esto bloquea: la app del bot **no se modifica**. Lo que hay que
configurar bien es la app nueva, desde cero y sin nada vivo encima. El App Secret que
haga falta será el de esa app, no el del bot.

### 1. Activación de Coexistence — hechos verificados

| Dato | Valor oficial |
|---|---|
| Prerequisitos | Tech Provider + Embedded Signup con session logging + app ≥ 2.24.17 |
| Flujo | El negocio entra por Embedded Signup, elige "conectar cuenta existente", recibe código, toca Conectar y **confirma compartir historial** |
| Historial | Hasta **180 días** en tres fases: día 0–1, día 1–90, día 90–180 |
| Ventana de sincronización | El partner debe iniciarla **dentro de las 24h** del alta |
| Media | Los asset IDs solo sincronizan para mensajes de los **14 días** posteriores al alta |
| Throughput | **20 mps** fijo mientras el número esté en app + Cloud API |
| Se apaga en 1:1 | Mensajes temporales, ver una vez, ubicación en vivo, listas de difusión |
| Meta Verified | **No aparece en la doc oficial.** Tratarlo como no verificado |

⚠️ **La confirmación de compartir historial la da Mauricio con el dedo, en el celular.**
Es el momento exacto en que 180 días de conversaciones personales quedan disponibles
para el partner. No se puede deshacer después. Ver punto 4.

### 2. Ventana de 24h y plantillas (alcance A)

Meta cobra **por mensaje entregado**, no por conversación, desde julio 2025.

| Situación | Qué se puede enviar | Costo Meta |
|---|---|---|
| Dentro de la ventana de servicio de 24h | Cualquier mensaje libre | **Gratis** |
| Dentro de la ventana, plantilla utility | Plantilla | **Gratis** |
| Fuera de la ventana | Solo plantillas aprobadas | Se cobra; **Colombia subió tarifas utility y authentication desde el 1-oct-2025** |
| Entrada por anuncio Click-to-WhatsApp | Cualquiera | Gratis por **72h** |

Consecuencia para la herramienta de Max: **responder desde la sesión, dentro de la
ventana, no cuesta nada.** El costo aparece solo si queremos iniciar conversación.
La herramienta debe mostrar los minutos que quedan de ventana antes de enviar, y
negarse a componer texto libre cuando esté cerrada — no dejar que falle contra Meta.

Plantillas mínimas a someter (yo las redacto): (a) reenganche de hilo vencido,
(b) opt-in inicial con link a la política, per `wa-opt-in-doble-compliance`.
Ninguna es marketing: todas utility. No someter nada hasta tener Gate 0 cerrado.

### 3. Modelo y costo por conversación

Tarifas verificadas hoy, por millón de tokens:

| Modelo | Input | Output |
|---|---|---|
| Gemini 2.5 Flash-Lite | $0,10 (audio $0,30) | $0,40 |
| Gemini 2.5 Flash | $0,30 (audio $1,00) | $2,50 |
| Gemini 3.5 Flash-Lite | $0,30 | $2,50 |
| Claude Haiku 4.5 | $1,00 | $5,00 |

**Triage → Gemini 2.5 Flash-Lite.** Es clasificación de tres clases sobre un mensaje
corto: ~700 tokens de entrada, ~30 de salida. **≈ $0,00008 por mensaje.** Haiku 4.5
hace lo mismo por ≈ $0,00085 — diez veces más por una tarea que no lo necesita.

**Extractor de perfil → Gemini 2.5 Flash.** Corre una vez por hilo cerrado, no por
mensaje, sobre ~4.000 tokens de entrada y ~250 de salida: **≈ $0,0018 por hilo**.
Aquí sí pago el salto sobre Flash-Lite ($0,0005) porque extraer campos estructurados
de una conversación real es donde un modelo flojo inventa, y el costo por hilo es
marginal. Escalada si no pasa la eval: Claude Haiku 4.5 (≈ $0,0053 por hilo).

**Costo total estimado ≈ $0,003 por conversación** (12 mensajes + una extracción).
Las notas de voz ya transcriben por `wa-transcribe.ts`; audio en Flash-Lite entra a
$0,30/M, así que un audio de 30 segundos añade fracciones de centavo.

⚠️ Esto es una **propuesta, no una decisión**. Mi protocolo exige eval dataset de
20–50 casos reales y benchmark de tres modelos antes de fijar. El clasificador entra
en modo sombra justamente para construir ese dataset con tráfico nuestro.

### 4. Mitad técnica del Gate 0 — el descarte se hace en Meta, no en el borde

Hallazgo que cambia el diseño: **los campos del webhook se suscriben selectivamente
en el App Dashboard.** No hay que filtrar lo que llega — hay que no pedirlo.

| Campo | Qué trae | Decisión |
|---|---|---|
| `messages` | Lo que la gente le escribe al número | **Suscribir.** Es el único que necesitamos |
| `history` | El backfill de 180 días | **NO suscribir.** Sin esto, el histórico personal nunca llega a nuestro servidor |
| `smb_message_echoes` | Lo que Mauricio envía desde el celular | **NO suscribir.** Sin esto, no vemos ni un mensaje saliente suyo |

Eso resuelve dos tercios del Gate 0 sin escribir una línea de código, y lo resuelve
en el lado correcto: el dato no viaja, en vez de viajar y confiar en que lo botamos.

Lo que queda para el borde, sobre `messages`:

1. **Match primero, persistir después.** `wa_id` contra `contactos`. Sin match y sin
   clasificación comercial, se responde 200 y se descarta **sin escribir a disco**.
2. **Prohibido copiar el patrón de `funnelchat_eventos`.** Esa función registra el
   cuerpo crudo antes de validar, y para una bitácora de diagnóstico está bien. Aquí
   sería exactamente la fuga que el Gate 0 existe para evitar.
3. **`contacts[0].profile.name` es dato personal** y llega en cada mensaje entrante.
   Decidir con Emilio si se guarda o se descarta junto al resto.
4. La telemetría y los logs de error **no pueden llevar el cuerpo del mensaje**, ni
   truncado. Solo `wa_id` hasheado, tipo de mensaje y veredicto del clasificador.

### Veredicto Yuto

**REVISAR antes de activar.** Nada técnico bloquea, pero hay dos cosas que no son mías
y hay que cerrar: el criterio legal de Emilio, y que Mauricio sepa que el dedo que
confirma "compartir historial" en el celular es irreversible. Con `history` y
`smb_message_echoes` sin suscribir, el riesgo real baja muchísimo — pero baja porque
alguien lo configuró bien, y eso hay que verificarlo en el App Dashboard, no asumirlo.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Se ingieren conversaciones personales | Gate 0. Sin regla escrita no se conecta |
| Coexistence topa a **20 mensajes/segundo** (dato oficial Meta; el "5 mps" que circula viene de blogs de vendors) | Irrelevante a nuestro volumen. Sí importa decirlo antes de vendérselo a un cliente con call center |
| Se apagan mensajes temporales, ver una vez, ubicación en vivo y **listas de difusión** en 1:1 | Aceptado. Avisar a quien use el número desde el celular ANTES de activar |
| El clasificador escribe basura en negocios reales | Propone, no ejecuta. Confirmación humana en A, B y C |
| Un envío desde la sesión llega a quien no debía | Confirmación explícita por envío + bitácora con autor |
| La prueba tumba el bot de producción (Cardumen, Venezuela, servicio) | Decisión 6: app, WABA y webhook separados. La app del bot no se modifica |
| Ban del número por saliente sin opt-in | Solo se responde dentro de ventana; proactivo exige doble opt-in |

## Orden de construcción

0. **Gate 0** — regla de ingesta escrita y aprobada por Emilio. Bloqueante.
1. Activar Coexistence. Verificar que entra un mensaje real al webhook y que el
   celular sigue funcionando igual.
2. **A** — responder desde la sesión, con confirmación y bitácora. Es lo que hace
   que el canal se sienta vivo desde el primer día.
3. **B** — clasificador en modo sombra: clasifica y registra, **sin disparar nada**.
   Se mide contra el tráfico real hasta que el acierto convenza.
4. **C** — match de contacto y extractor de perfil, en modo propuesta.
5. Conectar los triggers de B a `evaluar-reglas`. Solo aquí el canal empieza a
   mover el negocio solo.
6. **D** — catálogo, cuando no estorbe.

## Criterio de cierre

Un mensaje real que entra al número corporativo, se clasifica bien, se ata al contacto
correcto, propone un campo de perfil que un humano acepta, y la respuesta sale desde
esta sesión — con todo registrado y sin que ninguna conversación personal haya tocado
la base de datos.

## Refs

- `metrik-one/docs/specs/98F_ONE_Spec_WhatsApp_Flows.md` — spec original del canal
- `metrik-one/docs/wa-templates.md` — plantillas existentes
- `cerebro/reglas/wa-opt-in-doble-compliance.md` — doble opt-in
- `cerebro/conceptos/one-como-producto.md` — registro de campo por WhatsApp en el perímetro
- `proyectos/soena/ve/CONTEXT.md` — puntos 58 y 59, el caso que esto habilita
- [Coexistence](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/) · [Catálogos](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/catalogs-overview/)
