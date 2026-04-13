# wa-stress — Golden set runner

Suite de pruebas de regresión para el parser conversacional de WhatsApp (`wa-parse.ts`).
Corre un set de casos etiquetados contra la edge function `wa-parse-test` y mide:

- Intent accuracy (¿detectó el intent correcto?)
- Field accuracy (¿extrajo amount, project_code, category_hint, etc.?)
- Token usage por parser source (fast_path / gemini / regex)
- Latencia promedio por source y modelo
- A/B canary: si hay dos modelos configurados, compara ambos

**NO toca DB, NO envía WhatsApp, NO abre sesiones.** Solo corre `parseMessage()` y devuelve telemetría.

## Setup (una sola vez)

### 1. Deploy de la edge function

```bash
cd activos/metrik-one
SUPABASE_ACCESS_TOKEN=<tu-token> \
  npx supabase functions deploy wa-parse-test \
  --project-ref yfjqscvvxetobiidnepa \
  --no-verify-jwt
```

### 2. Generar y guardar el token de auth

```bash
# Generar token aleatorio
WA_STRESS_TOKEN=$(openssl rand -hex 32)
echo $WA_STRESS_TOKEN  # guardar en 1Password / .credentials.md

# Setear en Supabase
SUPABASE_ACCESS_TOKEN=<tu-token> \
  npx supabase secrets set WA_STRESS_TOKEN=$WA_STRESS_TOKEN \
  --project-ref yfjqscvvxetobiidnepa
```

### 3. (Opcional) Activar A/B canary

Para comparar dos modelos de Gemini lado a lado:

```bash
SUPABASE_ACCESS_TOKEN=<tu-token> \
  npx supabase secrets set \
  GEMINI_PARSE_MODEL=gemini-2.5-flash-lite \
  GEMINI_PARSE_MODEL_ALT=gemini-2.5-flash \
  GEMINI_PARSE_MODEL_ALT_PCT=50 \
  --project-ref yfjqscvvxetobiidnepa
```

El routing es determinístico por `bucket_key` (hash mod 100 < pct → ALT).
En `wa-webhook` el bucket_key es el teléfono; en el runner es `case.id`, así cada caso
siempre pega al mismo modelo entre corridas.

## Correr el golden set

```bash
cd activos/metrik-one

export WA_PARSE_TEST_URL="https://yfjqscvvxetobiidnepa.supabase.co/functions/v1/wa-parse-test"
export WA_STRESS_TOKEN="<el-token-generado>"

deno run --allow-net --allow-env --allow-read scripts/wa-stress/runner.ts
```

### Opciones

```bash
# Solo un intent (debug)
deno run ... scripts/wa-stress/runner.ts --only GASTO_DIRECTO

# Más concurrencia (cuidado con rate limits de Gemini)
deno run ... scripts/wa-stress/runner.ts --concurrency 6

# Output custom
deno run ... scripts/wa-stress/runner.ts --output results/baseline.jsonl

# Corpus alternativo
deno run ... scripts/wa-stress/runner.ts --corpus corpus/mi-corpus.jsonl
```

## Output

El runner imprime en consola:

1. Línea por caso: `✓` (intent + fields ok), `~` (intent ok, fields fail), `✗` (intent fail)
2. Resumen: total / intent_ok / fields_ok / errores / tiempo
3. Tabla por `parser_source`: count, accuracy, avg tokens in/out, avg latency
4. Intents con fallos (si los hay)
5. Detalle de casos fallidos con texto y diff de campos

Y guarda el JSONL crudo en `scripts/wa-stress/results/<timestamp>.jsonl` para análisis posterior.

**Exit code**: 0 si todo pasa, 1 si hay fallos. Útil para CI.

## Formato del corpus

Cada línea es un JSON con:

```json
{
  "id": "gasto-01",
  "text": "gasté 45000 en almuerzo para R1 26 1",
  "intent": "GASTO_DIRECTO",
  "expect": {
    "amount": 45000,
    "project_code": "R1 26 1"
  }
}
```

- `id` único (se usa como bucket_key para A/B)
- `text` como llegaría por WhatsApp
- `intent` esperado (valor de `WaIntent` en `types.ts`)
- `expect` campos que deben aparecer en `response.fields` con el valor correcto
  - Strings: comparación case-insensitive
  - Números: comparación estricta
  - Campos faltantes cuentan como fallo

## Agregar casos al corpus

Editá `corpus/golden.jsonl`. Un caso por línea. Agrupá por intent para legibilidad.
Después de agregar, corré el set completo y asegurate que el nuevo caso pase (si no,
es un bug del parser o una expectativa mal puesta — ajustá hasta que quede verde).

## Próximos pasos (Fase 2)

- Corpus generado por LLM (variaciones + fuzz + typos)
- LLM-as-judge para evaluar naturalidad de respuestas (no solo intents)
- Modo carga: concurrencia alta sostenida para validar rate limiting
