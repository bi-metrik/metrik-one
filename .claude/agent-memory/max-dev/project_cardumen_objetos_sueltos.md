---
name: cardumen-objetos-sueltos
description: Modo `objetos` de Cardumen (secuencia de repartos sueltos por WhatsApp) — por qué comparte tabla con la demo viva de Navigate y qué la mantiene fuera del motor de chat, por qué el modo entra con filas NUEVAS en vez de reusar las de miniweb, y qué quedó sin verificar sin un teléfono real
metadata:
  type: project
---

Rama `feat/cardumen-objetos-por-whatsapp` (2026-10-05, encargo de la sesión principal):
`cardumen_estudios.modo = 'objetos'`, la mitad de bot del modo "objeto suelto". La mitad web
YA estaba en producción (`reframeit.metrik.com.co/adultos` y `/ninos`, HTML fuera de este
repo en `proyectos/metrik/cardumen/navigate-demo/deploy/`): con `?obj=<id>` sirve UN reparto
a pantalla completa, hace POST a `cardumen-ingesta` y abre `wa.me` con
`Listo <objeto> 50-30-20` prellenado.

**Why:** que el regreso al chat dependa del TOQUE de la persona y no de un empujón del
servidor es el centro del diseño, no un detalle: cada mensaje de ella abre la ventana de
servicio de Meta, así que la secuencia NO necesita plantilla aprobada ni ventana de 24h.
Cualquier envío proactivo en el camino crítico tira eso por la borda.

**How to apply:**
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
- **El vector autoritativo es el del POST, no el del texto.** El texto sirve para AVANZAR.
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

Relacionado: [[pruebas-por-mutacion]], [[valida-migracion-antes-del-merge]].
