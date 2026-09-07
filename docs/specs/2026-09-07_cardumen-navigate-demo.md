# Cardumen · Navigate — bot de demo para Grupo Progreso

> Max · 2026-09-07 · Activador: la palabra `cardumen` al número de producción de MéTRIK.
> Método que gobierna este build: `proyectos/metrik/cardumen/docs/navigate-demo-revision-saga.md`
> (el experto ancla, no pondera; español activo, EN/PT no se traducen en caliente).
> Instrumento: `proyectos/metrik/cardumen/navigate-demo/data/meta.json`, clave `instrumento`.
> Mecánicas: `elicitacion-resolucion-yuto.md` (tríadas) y `elicitacion-diadas-yuto.md` (diadas).

## 1. Qué existía y qué se construyó

Evaluación del motor `_shared/cardumen` antes de escribir una línea:

| Pregunta | Lo que había | Lo que se hizo |
|---|---|---|
| (a) ¿Un estudio se define por datos o por código? | Por datos: `cardumen_estudios.spec` (jsonb `StudySpec`) + `cardumen_estudio_triggers` (palabra → estudio). Pero la **mecánica** es una sola y va en código: el entrevistador R1 con prompt abierto que *infiere* la inclinación de la narrativa y tiene prohibido presentar los polos como elección (regla 5b del prompt). | El estudio sigue siendo una fila. El spec lleva `motor: "navigate"` y el motor R1 delega a una máquina de estados nueva. Capa A vive en código (`navigate/instrumento.ts`), fijada por prueba contra `meta.json`. |
| (b) ¿Las tríadas implementan "ordena dos + gradúa"? | No. R1 captura `CapaAPlacement { lean, verbatim, na }`: un solo polo dominante en palabras, resolución gruesa, sin segundo ni intensidad. | "Reparto en dos tiempos" completo: una pregunta saca dominante + segundo; eco literal con confirmación; turno de intensidad con las tres etiquetas de peso; composición pre-registrada (§3.1). |
| (c) ¿Existen las diadas? | Como tipo (`dyads`) y en el prompt (`entre [A <-> B]`), capturadas igual de grueso: un `lean` textual. Sin anclas ni salidas especiales. | "Un turno, cinco anclas" con `middle` / `both_intense` / `not_applicable` / `dont_know`, valor pre-registrado (§4.1). |
| (d) ¿Qué guarda `cardumen_respuestas`? | Medido en producción: `id, estudio, token, lang, payload (jsonb), created_at`. Sin columna de demo, población ni sector. | Todo va en `payload`: `demo: true`, `poblacion`, `sector`, `idioma`, `idioma_detectado`, `consent`, `narrative.historia`, `capaA` por dimensión con los campos de piloto, `provenance`. **No hace falta columna nueva.** |

Verificado también en código: el bloque `0c` del webhook consulta el catálogo (`resolverEstudioChat`) **antes** de la palabra fija `isCardumenTrigger`, y el catálogo hoy no tiene la palabra `cardumen`. Una fila `cardumen → navigate` la captura; sin esa fila, el código nuevo es inerte y `cardumen` sigue mandando el link de la mini-web FEDE como hoy.

## 2. Archivos

Nuevo, en `supabase/functions/_shared/cardumen/navigate/`:

- `instrumento.ts` — Capa A literal de `meta.json`, aperturas de la sección 01 de la muestra, los 12 sectores, tablas de mapeo pre-registradas.
- `tipos.ts` — estado de la conversación, registros por dimensión (§3 de las dos specs), contrato del intérprete.
- `idioma.ts` — detector es/en/pt por palabras funcionales, determinista; ante la duda, "desconocido" (= español + confirmación).
- `interprete.ts` — la única puerta del modelo (`claudeHaiku`, el mismo del motor). Lee texto libre y devuelve JSON con índices y banderas. Lector por palabras primero (botones, etiquetas literales), modelo después.
- `motor.ts` — máquina de estados: turno cero, idioma, tríadas, diadas, cierre, `armarPayload`.
- `index.ts` — enganche con `cardumen_chat_sessions` y WhatsApp.
- `*.test.ts` — 59 pruebas (vitest), sin modelo ni red.

Modificado:

- `_shared/cardumen/types.ts` — campo opcional `motor?: "navigate"` en `StudySpec`.
- `_shared/cardumen/index.ts` — `startCardumenChat` y `continueCardumenChat` delegan si el spec/estado es Navigate. Nada más cambia para Araucanía ni Trappvel.
- `wa-webhook/index.ts` (bloque `0b`) — pasa `message.interactive_reply` (id del botón). El bloque `0a-ve` no se toca.
- `cardumen-cron/index.ts` — el recordatorio de 2 h (texto de La Araucanía) salta las sesiones Navigate.
- `sql/navigate-catalogo.sql` — alta del estudio y del trigger. Lo corre Mauricio.

## 3. Orden de puesta en marcha

1. Mergear el PR.
2. Desplegar las dos funciones (la clave `ANTHROPIC_API_KEY` ya está en los secrets: la usa el motor de Araucanía/Trappvel):
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

1. **Consentimiento de demo** con botón *OK*. Dice con todas las letras que es una demostración, que lo que responda se guarda marcado como prueba y no entra en ningún estudio ni se comparte. `no` cierra sin guardar nada.
2. **¿Responde como observador de su sector?** Botones *Sí, observador* / *No*. Define el flujo: ciudadano T1, T2, D1, D2; experto además T3 y D3.
3. **Sector**: lista numerada de 12. Se responde con el número o con el nombre (`salud`, `tecnologia`). Es lista numerada y no lista interactiva de WhatsApp porque esas admiten máximo 10 filas.
4. **Apertura** (Capa B): la pregunta del panel ciudadano o la de observadores, literal de la muestra. Se responde con la historia (texto o audio).
5. **Idioma**: se detecta en la historia. Si es español: *Seguimos en español, ¿le parece?* con botones. Si es inglés o portugués: un solo mensaje en los tres idiomas diciendo que por ahora el instrumento está en español, con botones *Sí / Yes / Sim* y *No*. Nunca se traduce nada. La historia se guarda tal como se escribió.
6. **Tríada** (T1, luego T2, y T3 para expertos): *"¿Cuáles dos pesaron más, y en qué orden?"* → eco literal *"Le leo entonces: primero X; en segundo lugar Y; y Z quedó al margen. ¿Lo dejo así?"* → botón *Sí, así* / *No, corrijo* → *"¿casi parejos, uno mandaba pero el otro contaba, o fue claramente X?"* (tres botones) → *"Listo. Lo guardo así: ..."*. Si nombra uno solo, se pide el segundo una vez; *ninguno* = "fue solo X" y no hay turno de intensidad.
7. **Diada** (D1, D2, y D3 para expertos): *"¿Siente que A, o que B?"* → si la respuesta es clara, eco + confirmación; si matiza, un menú corto con las anclas del lado que insinuó (se elige por número, sin confirmación extra). *"Las dos con fuerza"* se guarda como `both_intense`, no como 0,5.
8. **Cierre**: agradecimiento, recordatorio de que fue demo, y un resumen en palabras de lo que quedó registrado (Saga §2: se muestra la fila, no el punto en el mapa).

En cualquier momento: `salir` cierra (guarda lo que haya si ya hubo consentimiento, como incompleta); `borrar` elimina lo guardado y la sesión. Tras 24 h sin actividad la sesión se vence.

Sin la fila del catálogo, la palabra `cardumen` hace lo de siempre (link a la mini-web).

## 5. Qué se ve en `cardumen_respuestas`

Una fila por conversación, al cerrar:

```sql
select id, created_at, estudio, lang,
       payload->>'demo'            as demo,
       payload->>'poblacion'       as poblacion,
       payload->>'sector'          as sector,
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
  "idioma": "es", "idioma_detectado": "es", "idioma_confirmado": true,
  "consent": { "version": "navigate-demo-v1", "granted_at": "..." },
  "narrative": { "historia": "La carretera al puerto lleva meses..." },
  "capaA": {
    "T1_fuente": {
      "dimension_id": "T1_fuente", "poles": ["La gente comun, la vida de a pie", "Quienes tienen poder, dinero o influencia", "Fuerzas que nadie controla del todo"],
      "dominant": "Quienes tienen poder, dinero o influencia", "second": "Fuerzas que nadie controla del todo", "residual": "La gente comun, la vida de a pie",
      "intensity_label": "claramente_el_primero", "composition": [0.05, 0.85, 0.10],
      "resolution_captured": "high", "confirmed_by_participant": true, "special_case": null,
      "elicitation_turns": 3, "reflexivity_note": "ordeno dos polos espontaneamente; residual inferido; ..."
    },
    "D1_novedad": {
      "dyad_id": "D1_novedad", "poles": ["Esto ya venia pasando", "Esto es completamente nuevo"],
      "anchor_label": "intermedio_izq", "anchor_text": "mas cerca de \"Esto ya venia pasando\", con matices",
      "value": 0.25, "special_case": null, "resolution_captured": "high", "confirmed_by_participant": true,
      "elicitation_turns": 2, "reflexivity_note": "matizo hacia izq; se ofrecieron las anclas de ese lado; ..."
    }
  },
  "provenance": { "turns": 14, "started_at": "...", "closed_at": "...", "completa": true, "salida": "completa",
                  "dimensiones_capturadas": 4, "dimensiones_esperadas": 4, "raw_history": [ ... ] }
}
```

`token` es el teléfono, `lang` es `es` (el idioma del instrumento, bloqueado). El estudio no es `publicable`, así que nada sale por `v_cardumen_live`.

## 6. Decisiones que conviene saber

- **Los literales van tal como están en `meta.json`, tildes incluidas** ("La gente común", "Algo que se está acabando"). El brief pide Capa A exacta y la fuente única es ese archivo: si cambia la redacción, primero se cambia `meta.json` y después se copia (la prueba `instrumento.test.ts` obliga a mantenerlos iguales). El **sector** es la excepción deliberada: se **guarda** como slug sin tildes (`Infraestructura y construccion`, igual que `respuestas.json` de la muestra) y se **muestra** con la etiqueta con tildes de `SECTORES_CATALOGO` (`etiquetaSector`).
- **Registro de usted**, como en la muestra que ve el cliente. El guard de español neutro solo corrige voseo, no interfiere.
- **Anclas intermedias genéricas** ("más cerca de X, con matices" / "un poco de las dos"): las definitivas de Navigate las redacta Yuto cuando Saga avale el esquema (pendiente §9 de la spec de diadas). Los extremos son los polos literales.
- **`special_case: "unresolved"`** (no está en las specs): cuando tras dos intentos no se pudo leer un orden o un ancla, se guarda así y se sigue. Nunca se rellena.
- **"Fue solo X"**: 0,90 al dominante y el 0,10 residual partido en mitades entre los otros dos (la tabla §3.1 no dice cómo repartirlo).
- **Confirmación**: cuando la persona elige de un menú de anclas, se guarda sin volver a preguntar (`confirmed_by_participant: true`, porque eligió la etiqueta ella misma). Cuando el modelo leyó texto libre, siempre hay eco + botón antes de guardar.
- **La palabra `cardumen` deja de abrir la mini-web FEDE** mientras la fila del catálogo esté activa. Es el efecto buscado; se revierte con `activo = false`.
- El modelo se usa solo para leer (temperatura 0, JSON), una llamada por respuesta libre. Botones y etiquetas literales no gastan modelo.

## 7. Pendientes fuera de este PR

- Yuto: versiones EN y PT en autoría nativa (Saga §4, camino B) y anclas definitivas de las tres diadas.
- Saga: avalar las cinco anclas, `both_intense` y el tratamiento de `not_applicable` en el motor de análisis.
- Emilio y Lucía: consentimiento y habeas data para la ola 1 real (uso comercial). El turno cero de la demo no lo cubre ni pretende cubrirlo.
- Cablear respuesta real → paisaje sigue abierto; la demo muestra la fila, no el punto.
