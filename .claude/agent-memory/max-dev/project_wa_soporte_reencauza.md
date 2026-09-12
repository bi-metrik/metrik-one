---
name: wa-soporte-reencauza
description: PR #658 mergeado — el bot de WhatsApp ya no expulsa a quien contesta "Si" al soporte; qué NO llega nunca al handler, por qué el audio se clasifica, y que la edge function sigue SIN desplegar
metadata:
  type: project
---

**PR #658** (`a41dbbf`, 2026-09-12) mergeado con los cuatro checks verdes. Sin migración, sin
escrituras a producción. **La edge function `wa-webhook` NO se desplegó**: el brief lo prohibía
explícitamente, así que `main` y producción están desalineados y el arreglo está **inerte**
hasta que alguien la despliegue.

**Why:** en `awaiting_image` (soporte fotográfico de un gasto) el handler reconocía solo imagen,
audio y «después». Todo lo demás —incluido `"Si"`— caía por todas las ramas hasta
`completeSession`: la sesión se cerraba en silencio y el gasto quedaba con `soporte_pendiente:
true` para siempre. El síntoma del caso roto era **idéntico** al del sano (la sesión se cierra),
y por eso llevaba meses sin verse. Reproducido en Termotech; el defecto era transversal.

**How to apply:** la decisión de ese estado vive en
`supabase/functions/_shared/handlers/registro/soporte-foto.ts` (puro) y el sí/no en
`supabase/functions/_shared/wa-intencion.ts` (`clasificarRespuesta`). El handler solo ejecuta.
Invariante: **no entender nunca cierra**; solo cierran un desenlace explícito y el tope de
`soporte_reintentos` (2 repreguntas, guardado en `session.context`).

## ⚠️ Lo que NO llega nunca al handler: documento, video, sticker, contacto

`extractMessage` de `wa-webhook/index.ts` reconoce **solo** `text`, `image`, `audio`,
`interactive` y `location`, y devuelve `null` para todo lo demás **antes de que exista sesión**.
O sea: quien manda un **PDF** al bot no recibe absolutamente nada, en este flujo y en todos.
La rama «esto no es una foto» del #658 cubre en la práctica **ubicación, respuesta de Flow e
imagen sin `image_id`**, nada más.

**Why:** el brief pedía contestarle a un PDF y eso es **inalcanzable** sin tocar el enrutamiento
global del bot (reconocer `document` cambiaría qué llega a TODOS los flujos, no solo a este).
Quedó fuera de alcance y anotado en el PR.

**How to apply:** antes de prometer una respuesta a un tipo de mensaje de WhatsApp, comprobar
que `extractMessage` lo reconoce. Que el handler tenga la rama escrita no significa que pueda
dispararse.

## El audio ya viene transcrito: clasificarlo, no rechazarlo por ser audio

El paso 3.5 de `processMessage` transcribe el audio y lo mete en `message.text` **antes** de
enrutar a la sesión; el `type` sigue siendo `'audio'`. Por eso `decidirSoporte` clasifica el
texto del audio en vez de contestar «necesito una foto, no un audio» a secas.

**Why:** el brief decía «audio → mensaje actual; ya funciona, mantener», pero mantenerlo literal
dejaba un hueco de bucle: quien solo contesta hablando nunca podía salir, porque la rama de
audio no incrementaba el contador de reintentos. La invariante declarada («el usuario nunca
queda atrapado») gana sobre la instrucción literal. Un audio que **no** se entiende sí cuenta
como reintento y conserva el mensaje específico.

## `no` va antes que `si`, y `despues` antes que `no`

En `wa-intencion.ts` el orden de los patrones **no es cosmético**: «no tengo» contiene «tengo»
(marca de afirmación) y «ahorita no» es un aplazamiento, no una negativa. Invertirlo le pediría
la foto para siempre a quien no la tiene. Tres pruebas fijan ese orden.

⚠️ Lookarounds `\p{L}` con flag `u`, **nunca `\b`** ([[regex-js-b-ascii]]): sin ellos «sino» sería
un sí y «nota» un no. Y la puntuación se reemplaza por **espacio**, no se borra: `"no,tengo"`
tiene que quedar `"no tengo"`, no `"notengo"`.

## Los otros dos estados de `resume.ts` NO se migraron, y es deliberado

`confirming` y `awaiting_timeout_confirm` siguen con sus arreglos sueltos. Aceptan `'1'`,
`'✅'`, `'❌'` y `'confirmo'`, que el clasificador nuevo **no** reconoce, y aceptarían muchos
valores que hoy no. Migrarlos es cambio de comportamiento en dos flujos que nadie reportó rotos.
El motor de Cardumen tampoco se tocó: su literal responde a un instrumento aprobado por el
cliente.

Relacionado: [[merge-no-despliega-edge-function]] (si no existe, es lo que dice el CLAUDE.md del
repo), [[pruebas-por-mutacion]], [[worktree-git-bloqueado]].
