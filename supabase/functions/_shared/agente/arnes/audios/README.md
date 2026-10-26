# Arnés de audios: transcripción con pistas de la base (spec §4.6)

Mide si Gemini acierta lo que hace falta para registrar una nota de voz: nombres de personas y clientes, cifras y códigos. La tasa de error de palabras (WER) es secundaria. Además mide la **inserción falsa**: palabras de los nombres de la base que la transcripción escribe sin que se hayan dicho. Ese es el riesgo de las pistas.

Todo se corre desde la raíz de `metrik-one`. La llave entra SOLO por la variable `GEMINI_API_KEY_PRUEBAS`, nunca la de producción y nunca desde un archivo.

## Piezas

| Archivo | Qué es |
|---|---|
| `guiones.ts` | Los 20 guiones inventados: 7 de Imperviun, 7 de Laura y 6 de Sabor. Cada uno con su referencia, las palabras que cuentan marcadas, las condiciones, los distractores y la base inventada de su workspace |
| `metricas.ts` | Aciertos de nombres, cifras y códigos, inserción falsa, WER, agregado y veredicto |
| `corrida.ts` | Arma el mismo pedido de producción, con y sin pistas, y mide |
| `correr.ts` | La corrida (CLI) |
| `sintesis.ts`, `generar.ts` | Las notas sintéticas provisionales: TTS de Gemini y ruido mezclado con ffmpeg |
| `GRABAR.md` | Cómo grabar las notas reales que reemplazan a las sintéticas |

## 1. Generar las notas sintéticas provisionales

```bash
GEMINI_API_KEY_PRUEBAS=… deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/audios/generar.ts
```

- Quedan en `sinteticos/<id>.sintetico.ogg`, en OGG/Opus, con `sinteticos/manifiesto.json` (`sintetico: true`).
- `--ruidos <dir>` usa grabaciones reales de ambiente (`calle.ogg`, `obra.ogg`, `salon.ogg`) en vez del ruido sintético.
- Para probarlo sin red ni llave: `--seco --salida /tmp/audios-seco`. Produce un tono en vez de la voz.

## 2. La corrida

```bash
GEMINI_API_KEY_PRUEBAS=… deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/audios/correr.ts --salida /tmp/arnes-audios
```

- Corre cada nota con pistas y sin pistas, 3 veces (`--k`), con `gemini-2.5-flash-lite` (ONE hasta el 2026-10-26) y `gemini-3.5-flash-lite` (ONE desde el 2026-10-26 y público). Son 240 llamadas.
- Deja `resultado.json` y `tabla.txt`: una tabla general y una por workspace, los nombres y códigos fallados, y cada inserción falsa.
- Toma la nota real (`reales/<id>.ogg`) si existe y si no la sintética. Para usar solo las reales: `--fuente reales`.
- En seco, sin red: `--seco`.

## Regla para prender las pistas

Por modelo: nombres y códigos no bajan, al menos uno sube, y no suben ni la inserción falsa ni los fallos. Se decide con notas reales, no con las sintéticas.

El interruptor es por workspace, en `workspaces.config_extra.bot_conversacional.transcripcion`:

```json
{ "pistas": true, "tope": 40 }
```

Apagado, que es lo de hoy, no se lee la base y el prompt queda igual. El mismo interruptor vale para ONE, la bandeja y el asistente público (Chatwoot).
