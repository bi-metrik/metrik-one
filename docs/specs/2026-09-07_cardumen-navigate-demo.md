# Cardumen · Navigate — bot de demo para Grupo Progreso

> Max · 2026-09-07 · Activador: la palabra `cardumen` al número de producción de MéTRIK.
> Método que gobierna este build: `proyectos/metrik/cardumen/docs/navigate-demo-revision-saga.md`
> (el experto ancla, no pondera; español activo, EN/PT no se traducen en caliente).
> Instrumento: `proyectos/metrik/cardumen/navigate-demo/data/meta.json`, clave `instrumento`.
> Mecánicas: `elicitacion-resolucion-yuto.md` (tríadas) y `elicitacion-diadas-yuto.md` (diadas).
> 2026-09-08: el idioma se elige en el PRIMER mensaje, antes del consentimiento (§4, decisión de Mauricio tras probar el bot en vivo).

## 1. Qué existía y qué se construyó

Evaluación del motor `_shared/cardumen` antes de escribir una línea:

| Pregunta | Lo que había | Lo que se hizo |
|---|---|---|
| (a) ¿Un estudio se define por datos o por código? | Por datos: `cardumen_estudios.spec` (jsonb `StudySpec`) + `cardumen_estudio_triggers` (palabra → estudio). Pero la **mecánica** es una sola y va en código: el entrevistador R1 con prompt abierto que *infiere* la inclinación de la narrativa y tiene prohibido presentar los polos como elección (regla 5b del prompt). | El estudio sigue siendo una fila. El spec lleva `motor: "navigate"` y el motor R1 delega a una máquina de estados nueva. Capa A vive en código (`navigate/instrumento.ts`), fijada por prueba contra `meta.json`. |
| (b) ¿Las tríadas implementan "ordena dos + gradúa"? | No. R1 captura `CapaAPlacement { lean, verbatim, na }`: un solo polo dominante en palabras, resolución gruesa, sin segundo ni intensidad. | "Reparto en dos tiempos" completo: una pregunta saca dominante + segundo; eco literal con confirmación; turno de intensidad con las tres etiquetas de peso; composición pre-registrada (§3.1). |
| (c) ¿Existen las diadas? | Como tipo (`dyads`) y en el prompt (`entre [A <-> B]`), capturadas igual de grueso: un `lean` textual. Sin anclas ni salidas especiales. | "Un turno, cinco anclas" con `middle` / `both_intense` / `not_applicable` / `dont_know`, valor pre-registrado (§4.1). |
| (d) ¿Qué guarda `cardumen_respuestas`? | Medido en producción: `id, estudio, token, lang, payload (jsonb), created_at`. Sin columna de demo, población ni sector. | Todo va en `payload`: `demo: true`, `poblacion`, `sector`, `idioma`, `idioma_elegido`, `idioma_detectado`, `consent`, `narrative.historia`, `capaA` por dimensión con los campos de piloto, `provenance`. **No hace falta columna nueva.** |

Verificado también en código: el bloque `0c` del webhook consulta el catálogo (`resolverEstudioChat`) **antes** de la palabra fija `isCardumenTrigger`, y el catálogo hoy no tiene la palabra `cardumen`. Una fila `cardumen → navigate` la captura; sin esa fila, el código nuevo es inerte y `cardumen` sigue mandando el link de la mini-web FEDE como hoy.

## 2. Archivos

Nuevo, en `supabase/functions/_shared/cardumen/navigate/`:

- `instrumento.ts` — Capa A literal de `meta.json`, aperturas de la sección 01 de la muestra, los 12 sectores, tablas de mapeo pre-registradas.
- `tipos.ts` — estado de la conversación, registros por dimensión (§3 de las dos specs), contrato del intérprete.
- `idioma.ts` — dos lectores deterministas. `leerIdiomaElegido` lee la respuesta escrita al primer mensaje: palabras claras (`español`, `spanish`, `castellano`, `inglés`, `english`, `portugués`, `português`) y, si no las hay, detección por palabras funcionales; `null` = repreguntar una vez y a la segunda seguir en español. `detectarIdioma` sobre la historia solo registra `idioma_detectado` como dato.
- `interprete.ts` — la única puerta del modelo (`geminiFlashLite`, Gemini 3.1 Flash-Lite; el motor R1/R2 de Araucanía/Trappvel sigue en Haiku). Lee texto libre y devuelve JSON con índices y banderas. Lector por palabras primero (botones, etiquetas literales), modelo después. **El modelo entra en cuatro puntos y solo en cuatro:** orden de una tríada, segundo polo, etiqueta de peso y ancla de una diada. **La historia no pasa por el modelo**: se guarda tal cual y solo se le detecta el idioma.
- `meta.ts` — capa determinista que corre ANTES del modelo en todos los pasos: vacío / solo emojis (`sinPalabras`), pregunta de vuelta y negativa (`leerMeta`). Estrecha a propósito: un falso positivo se comería una respuesta real.
- `robustez.test.ts` — batería hostil por paso (Capa 1, §8); `golden-lector.json` + `golden-lector.test.ts` — golden set del lector (Capa 2, §8); `scripts/navigate-lector-eval.ts` — corre el golden contra el modelo vivo.
- `motor.ts` — máquina de estados: idioma (primer mensaje), turno cero, tríadas, diadas, cierre, `armarPayload`.
- `index.ts` — enganche con `cardumen_chat_sessions` y WhatsApp.
- `*.test.ts` — 798 pruebas (vitest), sin modelo ni red.

Modificado:

- `_shared/cardumen/types.ts` — campo opcional `motor?: "navigate"` en `StudySpec`.
- `_shared/cardumen/index.ts` — `startCardumenChat` y `continueCardumenChat` delegan si el spec/estado es Navigate. Nada más cambia para Araucanía ni Trappvel.
- `wa-webhook/index.ts` (bloque `0b`) — pasa `message.interactive_reply` (id del botón). El bloque `0a-ve` no se toca.
- `cardumen-cron/index.ts` — el recordatorio de 2 h (texto de La Araucanía) salta las sesiones Navigate.
- `sql/navigate-catalogo.sql` — alta del estudio y del trigger. Lo corre Mauricio.

## 3. Orden de puesta en marcha

1. Mergear el PR.
2. Desplegar las dos funciones (la clave `GEMINI_API_KEY` ya está en los secrets de `wa-webhook`: la usan el bot de Venezuela, `wa-parse` y la transcripción de audio):
   ```
   SUPABASE_ACCESS_TOKEN=sbp_... npx supabase functions deploy wa-webhook --project-ref yfjqscvvxetobiidnepa --no-verify-jwt
   SUPABASE_ACCESS_TOKEN=sbp_... npx supabase functions deploy cardumen-cron --project-ref yfjqscvvxetobiidnepa
   ```
3. **Después** del deploy, correr `sql/navigate-catalogo.sql` (SQL Editor de Supabase o MCP). Es idempotente.
   Si se corre antes del deploy, `cardumen` abriría el entrevistador R1 viejo con un spec sin dimensiones.
4. Probar end-to-end (sección 4).

Para apagar la demo sin borrar nada: `update public.cardumen_estudios set activo = false where estudio = 'navigate';` — con eso `cardumen` vuelve a mandar el link de la mini-web.

## 4. Cómo se prueba desde WhatsApp

Escribir `cardumen` al número de producción de MéTRIK. Recorrido esperado:

1. **Idioma**, primer mensaje tras `cardumen`, antes de cualquier otra cosa: `ES: ¿En qué idioma prefiere continuar? / EN: Which language do you prefer? / PT: Em que idioma prefere continuar?` con botones *Español* / *English* / *Português*. *Español* sigue al consentimiento. *English* o *Português*: un solo mensaje en los tres idiomas diciendo que por ahora el instrumento está en español, con botones *Sí / Yes / Sim* y *No*; *Sí* sigue al consentimiento en español, *No* cierra sin guardar nada (todavía no hay nada que guardar). Nunca se traduce nada. Escrito en vez de botón: valen las palabras claras (`español`, `spanish`, `castellano`, `inglés`, `english`, `portugués`, `português`) y, si no las hay, la detección por palabras funcionales; si sigue sin leerse, se repregunta una vez con el mismo mensaje y a la segunda se sigue en español (queda en `provenance.notas` e `idioma_elegido` va en `null`). En el aviso trilingüe, nombrar el español ("ok, spanish") vale como *Sí*.
2. **Consentimiento de demo** con botón *OK*, ya en un idioma que la persona entiende. Dice con todas las letras que es una demostración, que lo que responda se guarda marcado como prueba y no entra en ningún estudio ni se comparte. `no` cierra sin guardar nada.
3. **¿Responde como observador de su sector?** Botones *Sí, observador* / *No*. Define el flujo: ciudadano T1, T2, D1, D2; experto además T3 y D3.
4. **Sector**: lista numerada de 12. Se responde con el número o con el nombre (`salud`, `tecnologia`). Es lista numerada y no lista interactiva de WhatsApp porque esas admiten máximo 10 filas.
5. **Apertura** (Capa B): la pregunta del panel ciudadano o la de observadores, literal de la muestra. Se responde con la historia (texto o audio). Se guarda tal como se escribió y se le detecta el idioma **solo como dato** (`idioma_detectado`): ya no hay pregunta de idioma después de la historia, se pasa directo a la primera tríada.
6. **Tríada** (T1, luego T2, y T3 para expertos): *"¿Cuáles dos pesaron más, y en qué orden?"* → eco literal *"Le leo entonces: primero X; en segundo lugar Y; y Z quedó al margen. ¿Lo dejo así?"* → botón *Sí, así* / *No, corrijo* → *"¿casi parejos, uno mandaba pero el otro contaba, o fue claramente X?"* (tres botones) → *"Listo. Lo guardo así: ..."*. Si nombra uno solo, se pide el segundo una vez; *ninguno* = "fue solo X" y no hay turno de intensidad.
7. **Diada** (D1, D2, y D3 para expertos): *"¿Siente que A, o que B?"* → si la respuesta es clara, eco + confirmación; si matiza, un menú corto con las anclas del lado que insinuó (se elige por número, sin confirmación extra). *"Las dos con fuerza"* se guarda como `both_intense`, no como 0,5.
8. **Cierre**: agradecimiento, recordatorio de que fue demo, y un resumen en palabras de lo que quedó registrado (Saga §2: se muestra la fila, no el punto en el mapa).

En cualquier momento: `salir` cierra (guarda lo que haya si ya hubo consentimiento, como incompleta); `borrar` elimina lo guardado y la sesión. Tras 24 h sin actividad la sesión se vence.

**Por qué el idioma va primero (2026-09-08, decisión de Mauricio tras probar el bot en vivo).** Hasta el PR #570 el flujo era consentimiento → población → sector → historia → detección de idioma → confirmación (`idioma_confirmar` / `idioma_no_es`). Quien no hablaba español recibía cuatro mensajes en español que no entendía, incluido el consentimiento, y un consentimiento en un idioma que la persona no entiende no es consentimiento. Además el turno "Seguimos en español, ¿le parece?" era redundante si el idioma ya se había elegido y costaba un mensaje: se eliminó. Resultado: quien no habla español recibe el aviso trilingüe en el segundo mensaje en vez del sexto (tres turnos perdidos menos), y el consentimiento llega siempre en un idioma ya elegido. En términos de `instrumento-multilingue-saga.md` §5 ("detectar, confirmar, bloquear"): la **confirmación** pasa al inicio como elección explícita de la persona; la **detección** sobre la historia queda solo como dato (`idioma_detectado`) y no decide nada; el **bloqueo** sigue igual (`idioma: "es"`, el único instrumento que existe).

Sin la fila del catálogo, la palabra `cardumen` hace lo de siempre (link a la mini-web).

## 5. Qué se ve en `cardumen_respuestas`

Una fila por conversación, al cerrar:

```sql
select id, created_at, estudio, lang,
       payload->>'demo'            as demo,
       payload->>'poblacion'       as poblacion,
       payload->>'sector'          as sector,
       payload->>'idioma_elegido'   as idioma_elegido,
       payload->>'idioma_detectado' as idioma_detectado,
       payload->'provenance'->>'completa' as completa,
       payload->'narrative'->>'historia'  as historia,
       payload->'capaA'            as capa_a
  from public.cardumen_respuestas
 where estudio = 'navigate'
 order by created_at desc;
```

`payload` tiene esta forma (campos de piloto de Saga §3 incluidos):

```json
{
  "source": "chat", "motor": "navigate", "demo": true, "study_id": "navigate",
  "collection_mode": "panel_recurrente",
  "poblacion": "ciudadano", "sector": "Infraestructura y construccion",
  "idioma": "es", "idioma_elegido": "es", "idioma_detectado": "es", "idioma_confirmado": true,
  "consent": { "version": "navigate-demo-v1", "granted_at": "..." },
  "narrative": { "historia": "La carretera al puerto lleva meses..." },
  "capaA": {
    "T1_fuente": {
      "dimension_id": "T1_fuente", "poles": ["La gente comun, la vida de a pie", "Quienes tienen poder, dinero o influencia", "Fuerzas que nadie controla del todo"],
      "dominant": "Quienes tienen poder, dinero o influencia", "second": "Fuerzas que nadie controla del todo", "residual": "La gente comun, la vida de a pie",
      "intensity_label": "claramente_el_primero", "composition": [0.05, 0.85, 0.10],
      "resolution_captured": "high", "confirmed_by_participant": true, "special_case": null, "declinado": false,
      "elicitation_turns": 3, "reflexivity_note": "ordeno dos polos espontaneamente; residual inferido; ..."
    },
    "D1_novedad": {
      "dyad_id": "D1_novedad", "poles": ["Esto ya venia pasando", "Esto es completamente nuevo"],
      "anchor_label": "intermedio_izq", "anchor_text": "mas cerca de \"Esto ya venia pasando\", con matices",
      "value": 0.25, "special_case": null, "resolution_captured": "high", "confirmed_by_participant": true, "declinado": false,
      "elicitation_turns": 2, "reflexivity_note": "matizo hacia izq; se ofrecieron las anclas de ese lado; ..."
    }
  },
  "provenance": { "turns": 14, "started_at": "...", "closed_at": "...", "completa": true, "salida": "completa",
                  "dimensiones_capturadas": 4, "dimensiones_esperadas": 4, "notas": [], "raw_history": [ ... ] }
}
```

`token` es el teléfono, `lang` es `es` (el idioma del instrumento, bloqueado). El estudio no es `publicable`, así que nada sale por `v_cardumen_live`. Los tres campos de idioma: `idioma_elegido` es lo que la persona eligió en el primer mensaje (`es` / `en` / `pt`; `null` si no eligió y se cayó a español, con la nota en `provenance.notas`); `idioma_detectado` es lo que se detectó en la historia, dato para el instrumento EN/PT futuro, no decide nada; `idioma_confirmado` es que eligió español o aceptó seguir en español.

## 6. Decisiones que conviene saber

- **Los literales van tal como están en `meta.json`, tildes incluidas** ("La gente común", "Algo que se está acabando"). El brief pide Capa A exacta y la fuente única es ese archivo: si cambia la redacción, primero se cambia `meta.json` y después se copia (la prueba `instrumento.test.ts` obliga a mantenerlos iguales). El **sector** es la excepción deliberada: se **guarda** como slug sin tildes (`Infraestructura y construccion`, igual que `respuestas.json` de la muestra) y se **muestra** con la etiqueta con tildes de `SECTORES_CATALOGO` (`etiquetaSector`).
- **Registro de usted**, como en la muestra que ve el cliente. El guard de español neutro solo corrige voseo, no interfiere.
- **Anclas intermedias genéricas** ("más cerca de X, con matices" / "un poco de las dos"): las definitivas de Navigate las redacta Yuto cuando Saga avale el esquema (pendiente §9 de la spec de diadas). Los extremos son los polos literales.
- **`special_case: "unresolved"`** (no está en las specs): cuando tras dos intentos no se pudo leer un orden o un ancla, se guarda así y se sigue. Nunca se rellena. **`declinado: true`** (tampoco está en las specs) marca que la persona se negó a responder: en tríadas acompaña a `unresolved`, en diadas a `not_applicable`, para que el análisis pueda separarlo de "no le entendí" y de "ninguna de las dos me aplica".
- **"Fue solo X"**: 0,90 al dominante y el 0,10 residual partido en mitades entre los otros dos (la tabla §3.1 no dice cómo repartirlo).
- **Confirmación**: cuando la persona elige de un menú de anclas, se guarda sin volver a preguntar (`confirmed_by_participant: true`, porque eligió la etiqueta ella misma). Cuando el modelo leyó texto libre, siempre hay eco + botón antes de guardar.
- **La palabra `cardumen` deja de abrir la mini-web FEDE** mientras la fila del catálogo esté activa. Es el efecto buscado; se revierte con `activo = false`.
- El modelo se usa solo para leer (temperatura 0, JSON), una llamada por respuesta libre. Botones y etiquetas literales no gastan modelo.
- **El lector es Gemini, no Haiku.** Decisión de Mauricio del 2026-09-08 ("no leamos con Haiku, prefiero mantener Gemini"). El modelo concreto, `gemini-3.1-flash-lite`, lo eligió el golden set (§8): `GEMINI_LECTOR_MODELO` en `_shared/cardumen/model.ts`. El adaptador reusa `generate()` de `_shared/venezuela/gemini.ts` (mismo cliente que los bots de VE y de customer), con `responseMimeType: application/json`. R1/R2 no cambian.

## 8. Robustez ante ruido (PR de 2026-09-08)

**Invariante:** nunca se fabrica una ubicación de Capa A a partir de ruido. Una respuesta incoherente, fuera de tema, vacía, hostil o que responde a otra pregunta no puede terminar guardada como dominante/segundo/intensidad ni como ancla. Lo que no se puede leer se repregunta UNA vez con encuadre más claro; a la segunda queda `unresolved` y se avanza. La sesión no se cuelga, no se reinicia sola y no salta pasos.

### Capa determinista, antes del modelo (`meta.ts`, `motor.ts`)

| Entrada | Qué hace el motor |
|---|---|
| Vacío, solo espacios, solo emojis | "No me llegó texto…" + la pregunta pendiente. Cuenta como intento. No gasta modelo. |
| Botón de OTRO paso (WhatsApp deja tocar mensajes viejos) | Se ignora como botón; en pasos de texto se repregunta ("Ese botón era de una pregunta anterior…"). Un "OK" viejo a mitad de una tríada ya no confirma nada. |
| Pregunta de vuelta ("¿quién eres?", "¿esto es una encuesta?") | Una frase corta que responde y, en el MISMO mensaje, la pregunta pendiente. Cuenta como intento. |
| Negativa explícita ("no quiero responder", "paso") | Tríadas: `unresolved` con `declinado: true`. Diadas: `not_applicable` con `declinado: true`. Intensidad: el orden confirmado se conserva, grueso. Se avanza sin insistir. Antes del consentimiento (idioma incluido): no se guarda nada. En la historia: se explica una vez, a la segunda se cierra. |
| `cardumen` a mitad de conversación | "Ya estamos en la demostración. Seguimos donde íbamos:" + la pregunta pendiente. No reinicia, no cuenta. Antes del consentimiento (idioma, consentimiento) se repite la pregunta a secas. |
| "no soy observador" | Ciudadano (antes la palabra negada daba experto). |
| Ruido dos veces en el primer mensaje (idioma) | Se sigue en español y se pide el consentimiento; `idioma_elegido` queda en `null` con nota. El turno "¿seguimos en español?" posterior a la historia ya no existe (§4). Ruido dos veces en el aviso trilingüe cierra sin guardar: no había consentimiento ni historia que perder. |
| Contradicción literal ("los dos primero", "todos igual") | No llega al modelo: se repregunta con encuadre. |
| Etiqueta de peso por palabras | Solo las formas casi literales del botón. "mi pareja", "el mandato", "les contaba" y "claro" a secas ya no fabrican una etiqueta. |
| `especial` del modelo (no sabe / no aplica / las dos con fuerza) | Solo se acepta con evidencia léxica en la respuesta (`evidenciaEspecial`). Sin ella, un modelo chico usa "no aplica" como cajón para lo que está fuera de tema. |

Los contadores viven en un solo sitio (`sumarIntento` / `sinLectura`): ningún contador pasa de 2. La marca `declinado` es un campo del registro, no se deriva de la nota; el turno cero deja lo suyo en `provenance.notas`.

Lo que **no** llega al motor: imagen sin caption, ubicación, sticker, contacto y documento los filtra el webhook (bloque 0b) antes de `continueCardumenChat`, y el audio llega ya transcrito. Sticker, contacto y documento **no reciben respuesta** (`parseMessage` los descarta); la sesión queda intacta.

### Golden set del lector (`golden-lector.json`)

84 casos en los cuatro puntos donde entra el modelo, con las once categorías del brief en cada uno (fuera de tema, pregunta de vuelta, negativa, incoherente, contradicción, polo inexistente, responde a otra pregunta, enterrada en párrafo largo, mezcla de idiomas, insulto, riesgo) más casos válidos de control. Métrica: **falsas ubicaciones** (debía ser "no leído" y devolvió una ubicación); objetivo cero. `golden-lector.test.ts` fija en CI la forma del set y lo que la capa determinista garantiza; `scripts/navigate-lector-eval.ts` lo corre contra el modelo vivo:

```
node --no-warnings --experimental-strip-types scripts/navigate-lector-eval.ts [--proveedor gemini|claude] [--modelo <id>] [--solo T-01,D-15] [--json ruta]
```

El script corre **los mismos adaptadores que producción** (`_shared/cardumen/model.ts`, con un `Deno.env` mínimo para Node): ya no es un proxy, mide el lector desplegado tal cual, con su retry, su `responseMimeType` y su configuración de thinking. Por defecto evalúa `GEMINI_LECTOR_MODELO`; `--modelo` compara otro Gemini con precio registrado en `PRECIOS_GEMINI`; `--proveedor claude` corre el Haiku de R1/R2 como referencia (necesita `ANTHROPIC_API_KEY`, que no está en la torre). Al final imprime tokens y costo del set con el precio oficial. Sale con 1 si hubo alguna falsa ubicación.

### Lector: Gemini 3.1 Flash-Lite (eval del 2026-09-08)

Mauricio decidió que el lector no fuera Haiku sino Gemini. Entre los dos Flash-Lite con `GEMINI_API_KEY` en producción, la regla fue *el más barato que iguale o supere al otro en el golden set*. Dos corridas por modelo, desde la torre, con el adaptador de producción; las dos corridas de cada modelo dieron **exactamente lo mismo** (temperatura 0), así que la tabla es una por modelo:

| modelo | ok / 84 | falsas ubicaciones | lecturas equivocadas | no lecturas | tokens (entrada / salida) | USD por el set (precio oficial) |
|---|---|---|---|---|---|---|
| `gemini-2.5-flash-lite` (thinking apagado) | 78 | **2** (T-14, I-07) | 2 (I-05, D-11) | **2** (S-12, D-15) | 46.749 / 1.868 | 0,0054 (0,10 / 0,40 por 1M) |
| `gemini-3.1-flash-lite` | **83** | **1** (D-20) | 0 | **0** | 46.749 / 2.473 | 0,0154 (0,25 / 1,50 por 1M) |

Por punto, 3.1: tríada 26/26, segundo 16/16, intensidad 17/17, diada 24/25. 2.5: 25/26, 15/16, 15/17, 23/25.

**Queda `gemini-3.1-flash-lite`.** 2.5 no iguala a 3.1 en la métrica que importa (2 falsas contra 1) ni en las no lecturas (2 contra 0: "ninguno" al pedir el segundo polo, y el caso enterrado en un párrafo largo, que el brief exige leer). El costo sube ~3x, pero son USD 0,015 por 77 llamadas: una conversación completa gasta menos de un centavo con cualquiera de los dos. Precios de `ai.google.dev/gemini-api/docs/pricing`, consultados ese día.

Lo que sigue abierto con 3.1: **D-20** ("nuevo no del todo, pero se aceleró mucho este año", categoría *matiz*) lo lee como ancla 2 firme en vez de "lado izquierdo, sin ancla". No es una ubicación que se guarde sola: una lectura de texto libre siempre pasa por eco + botón de confirmación antes de registrarse (§6), así que la persona corrige. Sigue contando como falsa para la métrica. Lo que 2.5 fallaba y 3.1 no: T-14 (dos polos que no existen, "la religión y después el fútbol", ubicados en índices reales), I-07 (un orden dado cuando se pedía un peso, leído como "claramente el primero"), S-12 y D-15.

Nota sobre thinking: en la familia 2.5 se manda `thinkingBudget: 0` (apagado). En la 3.x ese parámetro se ignora en silencio y el control es `thinking_level`, que la doc oficial no lista para `gemini-3.1-flash-lite`; no se manda nada, igual que en `meta-leads/entender-formulario.ts`. Los ~600 tokens de salida de más que muestra 3.1 son los de pensamiento, que se cobran como salida y van sumados en `usage.out`.

### Caso de riesgo (mención de hacerse daño)

Hoy el motor lo trata como ruido: el texto va al lector, no se lee (o el lector por palabras lo deja en "no gradúa"), se repregunta con encuadre y a la segunda queda `unresolved`. No hay detección ni protocolo; diseñarlo es de Emilio.

## 7. Pendientes fuera de este PR

- Yuto: versiones EN y PT en autoría nativa (Saga §4, camino B) y anclas definitivas de las tres diadas.
- Saga: avalar las cinco anclas, `both_intense` y el tratamiento de `not_applicable` en el motor de análisis.
- Emilio y Lucía: consentimiento y habeas data para la ola 1 real (uso comercial). El turno cero de la demo no lo cubre ni pretende cubrirlo.
- Cablear respuesta real → paisaje sigue abierto; la demo muestra la fila, no el punto.
