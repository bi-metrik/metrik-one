---
name: cardumen-objetos-sueltos
description: Modo `objetos` de Cardumen (secuencia de repartos sueltos por WhatsApp) — por qué el regreso al chat dejó de depender del toque de la persona (un `wa.me` relanza la app), qué convierte eso a `cardumen-ingesta` en posible vector de envío y cómo se contuvo, por qué comparte tabla con la demo viva de Navigate, y qué queda sin verificar sin un teléfono real
metadata:
  type: project
---

Rama `feat/cardumen-objetos-por-whatsapp` (2026-10-05, encargo de la sesión principal):
`cardumen_estudios.modo = 'objetos'`, la mitad de bot del modo "objeto suelto". La mitad web
YA estaba en producción (`reframeit.metrik.com.co/adultos` y `/ninos`, HTML fuera de este
repo en `proyectos/metrik/cardumen/navigate-demo/deploy/`): con `?obj=<id>` sirve UN reparto
a pantalla completa, hace POST a `cardumen-ingesta` y abre `wa.me` con
`Listo <objeto> 50-30-20` prellenado.

⚠️⚠️ **El regreso por `wa.me` NO FUNCIONA, y la premisa de diseño se cayó entera
(2026-10-07, PR `feat/cardumen-regreso-nativo`, medido por Mauricio con su teléfono).**
Desde el **navegador interno de WhatsApp un `wa.me` no devuelve a la conversación: RELANZA la
app.** La persona aterriza en el chat de MeTRIK pero no donde salió, y el hilo se siente roto.
Textual: *«no regresa nativamente al chat de donde salimos. Esto es lo más grave»*. Lo que sí
devuelve al punto exacto es el **cierre nativo de la ventana** del navegador interno, así que
la página le dice «cierra esta ventana» y **el bot continúa solo al recibir el POST**.

**Why:** la versión anterior de esta memoria decía que depender del toque era «el centro del
diseño». La parte que se sostiene es la de Meta: la persona escribió al bot minutos antes para
recibir el link, así que **la ventana de servicio de 24h está abierta y no hace falta
plantilla** — continuar desde el servidor no cuesta una plantilla aprobada. Lo que no se
sostenía era creer que el toque devolvía al hilo. Hermano de [[medir-antes-de-construir]]: la
premisa era verificable con un teléfono y nadie la había verificado.

⚠️⚠️ **El cambio convierte `cardumen-ingesta` (público, `verify_jwt = false`) en un posible
vector de envío de WhatsApp.** Antes un POST falso escribía una fila; ahora haría que el bot
mande un mensaje a un número. Las **cuatro invariantes** que lo contienen viven en
`_shared/cardumen/objetos-post.ts` con su prueba y su mutación corrida en
`objetos-post.test.ts`: (1) solo continúa si hay sesión de objetos **ABIERTA** para ese
teléfono; (2) **el destino sale de `cardumen_chat_sessions.phone`, nunca del cuerpo** — el
`token` es solo llave de búsqueda, y el cuerpo además trae `payload.participante`, que es el
señuelo realista; (3) el `objeto` tiene que ser **exactamente** el paso pendiente y el
`estudio` el de la sesión; (4) tope de **6 envíos por teléfono cada 10 min** (el guion más
largo tiene 4 repartos: una entrevista honesta nunca lo toca).
**La respuesta del endpoint NO dice si hubo continuación ni por qué**: sería un oráculo para
averiguar qué teléfonos tienen entrevista abierta y en qué paso van. El motivo va solo al log.

⚠️ **La invariante del destino es estructural, no verificable por mutación.** Sustituir
`fila.phone` por el token normalizado **no hace fallar ninguna prueba**, porque el lookup es
por igualdad exacta contra `phone`: los dos son el mismo valor siempre. Esa igualdad *es* la
razón por la que el cuerpo no puede nombrar un destinatario. Lo que sí cae por mutación es
tomar el destino de `payload.participante`. Vale la pena distinguirlo en vez de inventar una
mutación que no existe.

⚠️ **El texto `Listo ...` sigue en pie como salida de EMERGENCIA y hay que mantenerlo
idempotente en LOS DOS ÓRDENES** (`estado.por_post` + decisión `ya_atendido` + llave de
no-duplicado `(estudio, token, objeto)`):
- **POST→texto**: el texto que llega después no avanza ni acusa; silencio a propósito.
- **texto→POST**: el POST **actualiza** la fila del texto en vez de insertar una segunda. La
  llave vieja (id de sesión del payload) **nunca** colisionaba — el de la página es un uuid
  nuevo por carga y el del texto es `wa-<tel>-<paso>` — así que ese orden dejaba **dos filas
  del mismo reparto**, una con vector medido y otra con el aproximado, sin saber cuál es cuál.
- Un **link viejo reenviado por POST no reenvía nada** (a diferencia del texto, que acusa y
  reenvía el pendiente): reenviar es justo el botón que vuelve repetible un POST válido. Si
  alguien reabre un link viejo y re-envía, queda sin empujón nuevo — tiene el mensaje del paso
  pendiente ya en su chat y queda el recordatorio del cron.

**How to apply:**
- **Un avance, una aritmética.** `avanceDesdePaso` en `objetos.ts` la comparte el camino del
  texto y el del POST, y hay una prueba que compara las dos decisiones paso a paso. Separarlas
  en dos copias deja una atrás, y el síntoma es un `bot` del guion perdido (error de medición).
- **Sin migración**: los campos nuevos del estado (`por_post`, `post_envios`, `post_ventana`)
  viven en el `jsonb` de `cardumen_chat_sessions.state`, que no tiene esquema.
- ⚠️ **`cardumen-ingesta` ahora importa `wa-respond.ts`**: necesita `WHATSAPP_PHONE_NUMBER_ID`
  y `WHATSAPP_ACCESS_TOKEN` en el entorno de la función. Son secretos de proyecto (los mismos
  de `wa-webhook`), pero sin ellos el guardado funciona y el envío falla en silencio.
- ⚠️ **La sesión de objetos vive en `cardumen_chat_sessions`, la MISMA tabla que Navigate
  (demo viva de Grupo Progreso).** Lo único que la separa es `state.modo = 'objetos'`:
  el bloque 0b del webhook la desvía con `esEstadoObjetos` ANTES de transcribir audio o
  llamar `continueCardumenChat`, y `continueCardumenChat` tiene la misma guarda como
  cinturón. Sin eso el entrevistador leería `Listo preocupaciones 50-30-20` como narrativa
  — y **la palabra de consentimiento por defecto del encuadre de chat es justamente
  "LISTO"**, así que el daño sería silencioso. Ver [[cardumen-navigate-demo]].
- **Filas y palabras NUEVAS, no las de `miniweb`.** Una fila tiene UN `modo`, y las dos
  filas vivas (`cardumen-instrumento-adultos` / `-ninos`, palabras `cardumen adultos` /
  `cardumen ninos`) despachan el instrumento COMPLETO, que es lo que está evaluando la
  metodóloga del cliente. Entran `cardumen-objetos-adultos` / `-ninos` con palabras
  `objetos adultos` / `objetos ninos` / `repartos`. Ver [[cardumen-miniweb-catalogo]].
- **Por eso la url del paso lleva `&e=<slug>` explícito.** La página, sin `e`, asume el slug
  del instrumento completo (`PARAMS.get('e') || 'cardumen-instrumento-adultos'`) y el POST
  mezclaría las dos formas de captura en el mismo `estudio`.
- **El bot conduce la entrevista COMPLETA, no solo los repartos** (autorizado por Mauricio
  el 2026-10-05, cerrando el hueco que dejó la primera versión: los dos primeros repartos de
  adultos preguntan "en esa situación" y nadie había pedido la situación). El `spec` es una
  lista de `pasos` con `tipo`: `chips` (opción única), `relato` (micro-narrativa) y `reparto`.
  La página sigue sirviendo SOLO los repartos (`pasoPorId` filtra `t === 'reparto'`).
- ⚠️⚠️ **Los cuatro `t:'bot'` del guion SON pasos (`tipo: 'bot'`), no decoración.** Entraron
  el 2026-10-05 después de que los descarté y Mauricio los revisó uno por uno. El que más
  pesa: *«Ahora salgamos de esa historia y hablemos de tu semana»* es un **cambio de marco**
  — los tres repartos anteriores son sobre la situación difícil y `semana` es sobre la semana
  en general. Sin esa frase la persona sigue contestando sobre la situación puntual y el dato
  de `semana` mide otra cosa: **es error de medición, no estética.** Los otros dos que cargan
  peso: *«Yo no la interpreto»* (la regla que hace de esto auto-significación) y *«si subes
  uno, los demás ceden»* (instrucción de uso del objeto). Niños tiene sus equivalentes.
  Se dicen y la secuencia avanza sola, sin fila. `tramoDesde` los recoge; hay una prueba que
  verifica que **ninguno se pierde ni se repite** al recorrer la entrevista entera.
- ⚠️ **El avance se cuenta desde el paso RESPONDIDO, no desde `estado.paso`.** Con `bot`
  intercalados no es lo mismo: `pasoPendiente` los salta para encontrar a quién preguntar, y
  sumarle 1 al índice viejo deja la secuencia un paso atrás y repite el texto. Lo encontró una
  prueba, no el razonamiento.
- ⚠️⚠️ **Los enunciados son LITERALES y el relato se guarda VERBATIM.** El bot manda
  `paso.pregunta` tal cual, en su propio mensaje y sin nada pegado; no parafrasea, no resume
  la historia ni se la repite a la persona en otras palabras, y NADA de esto pasa por un LLM.
  Un paso narrativo sin `pregunta` invalida el spec a propósito. Si el enunciado cambia entre
  participantes las respuestas dejan de ser comparables, y un resumen del bot mete la
  interpretación del modelo dentro del dato. El acuse solo existe en el cuerpo del botón de
  un reparto, que no es un enunciado.
- ⚠️ **`sendButtons` recorta a 3 EN SILENCIO** (`buttons.slice(0, 3)`). Dos pasos del
  instrumento tienen 4 y 5 opciones (`antiguedad` de adultos, `edad` de niños), así que arriba
  de 3 va `sendNumberedMenu` — el mismo camino que ya eligió Navigate para sus 12 sectores.
  `leerChips` acepta el id del botón, el número de la lista y el literal escrito.
- **`normalizarTexto` SÍ normaliza la ñ** (NFD + quitar marcas), al contrario de
  `normalizarTrigger`: quien escribe "mas de 7 anos" igual contesta. Medido, no supuesto.
- **La voz se transcribe solo si el paso pendiente es un `relato`**, y la fila queda con
  `transcrito_de_audio: true`: una transcripción no es el texto que la persona escribió.
- **Un relato corto nunca bloquea**: UNA repregunta neutra (`estado.repreguntados`) y después
  se acepta como venga.
- **El vector autoritativo es el del POST, no el del texto** (y desde el 2026-10-07 el POST es
  además la vía por la que la secuencia avanza). El texto sirve para AVANZAR.
  Solo si no hay fila para `(estudio, token, payload->>objeto)` se guarda el derivado del
  texto, marcado `origen: 'texto_whatsapp'` y bajo la clave `vector_aproximado` (no
  `vector`). Requisito metodológico de Saga. Si la consulta del duplicado FALLA, se asume
  que sí hay: un duplicado sin saber cuál es el medido es peor que un hueco.
- El recordatorio reusa `reminded_at` y la ventana 2-24h de `cardumen-cron`; es UNO solo. El
  cron también CIERRA las sesiones de >24h, así que una secuencia abandonada se pierde igual
  que una conversación.
- El texto del `encuadre` sembrado es BORRADOR: dice que las respuestas se envían al estudio
  y que el número queda ligado como identificador, pero lo revisa Emilio (CLO), y el de
  niños ni siquiera tiene decidido quién consiente.

- ⚠️ **El nombre de la migración lo pone la hora, no un contador: dos sesiones del mismo día
  chocan.** Esta nació `20261005120000` y mientras estaba abierta entró a main
  `20261005120000_negocio_cruces_avanzados.sql` (#1016), ya aplicada en producción. Mismo
  timestamp = orden de aplicación indefinido, y **`check:migraciones` dijo «sin problemas»
  porque corría contra una base sin la otra**. Renumerada a `20261005170000`. Antes de dar por
  verde una rama con migración: traer `origin/main` y comparar contra su timestamp más alto.
- ⚠️ Sus opciones `'1 a 3 años'` / `'3 a 7 años'` la hacen caer en el barrido de
  [[retencion-control-en-ci]]: tiene entrada `no-es-plazo` en `retencion.test.ts`, **indexada
  por ruta**, así que renumerarla otra vez vuelve a tumbar esa prueba.

Relacionado: [[pruebas-por-mutacion]], [[valida-migracion-antes-del-merge]],
[[retencion-control-en-ci]].
