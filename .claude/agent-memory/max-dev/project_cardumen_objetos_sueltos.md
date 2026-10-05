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
- **La secuencia solo puede tener pasos de tipo `reparto`**: en modo objeto la página filtra
  `t === 'reparto'` (`pasoPorId`). Los pasos narrativos del instrumento (`historia`,
  `cierre_narrativo`, los `chips` de edad/antigüedad) NO están, y eso deja un hueco REAL:
  los dos primeros objetos de adultos preguntan "en esa situación" / "eso que contaste" y
  nadie pidió la situación. El bot que conduzca la parte narrativa no existe todavía.
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
