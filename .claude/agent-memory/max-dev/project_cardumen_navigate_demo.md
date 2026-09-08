---
name: cardumen-navigate-demo
description: Bot Navigate (Cardumen x Reframeit) para la demo a Grupo Progreso — motor determinista aparte del R1/R2, orden de puesta en marcha (deploy ANTES del SQL), qué cambia para la palabra `cardumen`, y la capa de robustez ante ruido (meta.ts, golden del lector, qué modelo lee de verdad)
metadata:
  type: project
---

El estudio `navigate` (PR #556, 2026-09-07; robustez en el PR de 2026-09-08, rama
`feat/cardumen-navigate-robustez`) NO usa el entrevistador R1/R2: es una máquina de estados en
`supabase/functions/_shared/cardumen/navigate/` y el modelo solo LEE texto libre a JSON
(`interprete.ts`). El catálogo lo declara con `spec.motor = "navigate"` y
`startCardumenChat`/`continueCardumenChat` delegan por ese campo.

**Why:** el R1 infiere la inclinación de la narrativa y tiene PROHIBIDO presentar los polos como
elección (regla 5b del prompt); las specs de Navigate piden lo contrario (ordenar dos polos +
graduar, cinco anclas). No era una config, era otra mecánica. Y Saga exige que el modelo no
redacte ni traduza nada del instrumento.

**How to apply:**
- **Orden de puesta en marcha: desplegar `wa-webhook` y `cardumen-cron` PRIMERO, correr
  `sql/navigate-catalogo.sql` DESPUÉS.** Al revés, `cardumen` abre el R1 viejo con un spec sin
  dimensiones. Sin la fila del catálogo el código nuevo es inerte.
- Mientras la fila esté `activo = true`, la palabra `cardumen` **deja de mandar el link de la
  mini-web FEDE** (`sendCardumenLink` queda inalcanzable). Se revierte con `activo = false`.
- `cardumen_respuestas` solo tiene `id, estudio, token, lang, payload, created_at`: la bandera
  `demo`, población, sector, idioma y los campos de piloto van dentro de `payload`. No hay columna
  nueva ni migración.
- Los literales de Capa A se copian de `meta.json` (fuente única) **con sus tildes** y la
  prueba `instrumento.test.ts` los fija. Cambiar la redacción = cambiar meta.json primero.
  Excepción deliberada: el **sector se guarda como slug SIN tildes** (coincide con
  `respuestas.json` de la muestra) y se muestra con la etiqueta de `SECTORES_CATALOGO`
  (`etiquetaSector`); `leerSector` compara normalizado, así que tecleado con o sin tildes resuelve.
- Las anclas intermedias de las diadas son genéricas ("más cerca de X, con matices"); las
  definitivas las redacta Yuto cuando Saga avale el esquema (spec de diadas §9).
- El registro es de **usted**, como la muestra del cliente; el guard `es-neutro.ts` solo corrige
  voseo y no interfiere.
- Sector va por lista numerada, no por lista interactiva de WhatsApp: esas admiten 10 filas y son 12.
- El cron `cardumen-cron` salta sesiones con `state.motor = 'navigate'` porque su recordatorio es
  texto de La Araucanía.
- El webhook (bloque 0b) ahora pasa `message.interactive_reply` como 5.º parámetro de
  `continueCardumenChat`; el motor decide por id de botón y acepta el texto como equivalente.

## Robustez ante ruido (2026-09-08)

- **El lector de producción es Claude Haiku 4.5** (`_shared/cardumen/model.ts`, secreto
  `ANTHROPIC_API_KEY` del edge function), **no Gemini**, y **la historia NO pasa por el modelo**
  (se guarda tal cual; solo se le detecta el idioma). El modelo entra en cuatro puntos: orden de
  tríada, segundo polo, etiqueta de peso, ancla de diada. Un brief que diga "la historia es un
  punto de lectura" hereda una premisa falsa.
- **En la torre no hay `ANTHROPIC_API_KEY`** (solo `ANTHROPIC_BASE_URL`); sí hay `GEMINI_API_KEY`
  en `.env.local`. El golden del lector (`golden-lector.json`, 84 casos) se corrió con
  **Gemini 2.5 Flash-Lite como PROXY** vía `scripts/navigate-lector-eval.ts --proveedor gemini`.
  Mide el prompt y las guardas deterministas, no el lector desplegado: hay que correr
  `--proveedor claude` desde una máquina con la llave antes de dar por medida la Capa 2.
- **`meta.ts` corre ANTES del modelo en todos los pasos:** vacío/solo emojis, pregunta de vuelta
  ("¿quién eres?" → frase corta + la pregunta pendiente en el MISMO mensaje, cuenta como intento)
  y negativa ("paso" → tríada `unresolved` + `declinado: true`; diada `not_applicable` +
  `declinado: true`; se avanza sin insistir). Medido con el proxy: `"paso"` solo llegó al modelo
  como ancla 2 (`paso` ~ `pasando`). La capa determinista no es opcional.
- **Falsas ubicaciones deterministas que existían y se cerraron:** `intensidadPorPalabras` leía
  por prefijo (`parej` → "mi pareja", `manda` → "el mandato", `claro` a secas → "claramente el
  primero", `claramente el clima`); ahora solo las formas casi literales del botón. Y un
  `especial` del modelo (`not_applicable`/`dont_know`/`both_intense`) solo se acepta con evidencia
  léxica (`evidenciaEspecial`): sin eso, Gemini usaba "no aplica" como cajón para fútbol, insultos
  y el caso de riesgo.
- Un botón de OTRO paso se ignora como botón (`BOTONES_DEL_PASO`); `cardumen` a mitad repite la
  pregunta pendiente sin reiniciar; ruido ×2 en "¿seguimos en español?" sigue en español (antes
  cerraba sin guardar y botaba la historia); "no soy observador" es ciudadano.
- Los contadores viven en `sumarIntento`/`sinLectura`/`fallaLectura` (motor.ts): tope 2 en un solo
  sitio. `robustez.test.ts` (632 casos) inyecta la batería hostil en cada paso, ciudadano y experto.
- **Caso de riesgo ("me quiero morir"):** hoy es ruido — no se lee, se repregunta, `unresolved`.
  Sin detección ni protocolo; es de Emilio.
- **Hueco documentado, no cerrado:** sticker, contacto y documento no reciben respuesta
  (`parseMessage` del webhook los descarta); la sesión queda intacta.

Relacionado: [[canal-wa-propio]], [[pruebas-por-mutacion]], [[medir-antes-de-construir]].
