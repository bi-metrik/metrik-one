// Adaptadores de modelo para Deno (Edge Function). Las claves viven en los secrets del edge
// function, nunca en el cliente.
//
// - `claudeHaiku()`: Claude Haiku 4.5, el modelo tuneado/validado del motor R1/R2 (ANTHROPIC_API_KEY).
// - `geminiFlashLite()`: Gemini Flash-Lite, el LECTOR de Navigate (GEMINI_API_KEY). Decision de
//   Mauricio del 2026-09-08: el lector no es Haiku, se queda en Gemini.

import type { ModelAdapter, ModelCallOpts, ModelResult, ModelMessage } from "./types.ts";
import { generate } from "../venezuela/gemini.ts";

async function withRetry<T>(fn: () => Promise<T>, tries = 5, baseMs = 800): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = (e as Error).message ?? "";
      // 529 = Anthropic overloaded (faltaba); tambien 429/500/502/503/504 y textos de sobrecarga/timeout.
      const transient = /\b(429|500|502|503|504|529)\b/i.test(msg) || /overloaded|high demand|rate.?limit|timeout/i.test(msg);
      if (!transient || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}

export function claudeHaiku(): ModelAdapter {
  const modelId = "claude-haiku-4-5";
  return {
    id: modelId,
    pricing: { in: 1.0, out: 5.0 },
    async call(opts: ModelCallOpts): Promise<ModelResult> {
      const key = Deno.env.get("ANTHROPIC_API_KEY");
      if (!key) throw new Error("ANTHROPIC_API_KEY no esta en los secrets del edge function");
      const messages = opts.messages.map((m: ModelMessage) => ({
        role: m.role === "system" ? "user" : m.role,
        content: m.content,
      }));
      const data = await withRetry(async () => {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: modelId,
            max_tokens: opts.maxTokens ?? 1024,
            temperature: opts.temperature ?? 0.7,
            system: opts.system,
            messages,
          }),
        });
        if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
        return res.json();
      });
      const text = data?.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "";
      const u = data?.usage ?? {};
      return { text, usage: { in: u.input_tokens ?? 0, out: u.output_tokens ?? 0 } };
    },
  };
}

// ---- Gemini (lector de Navigate) -----------------------------------------------------------

/** Modelo del lector de Navigate en produccion. Es el que corre el eval por defecto
 *  (`scripts/navigate-lector-eval.ts`): si cambia aqui, el eval lo sigue solo.
 *  Elegido por el golden set del 2026-09-08 (dos corridas por modelo, identicas): 3.1 deja 1 falsa
 *  ubicacion y 0 no lecturas en 84 casos; 2.5 deja 2 y 2. Cuesta ~3x, y son USD 0,015 por los 84
 *  casos. Detalle en `docs/specs/2026-09-07_cardumen-navigate-demo.md` §8. */
export const GEMINI_LECTOR_MODELO = "gemini-3.1-flash-lite";

// Precio oficial, USD por 1M tokens de TEXTO (ai.google.dev/gemini-api/docs/pricing, consultado
// el 2026-09-08). Un modelo sin fila aqui no se puede instanciar: el precio se mira en la doc,
// no se adivina.
const PRECIOS_GEMINI: Record<string, { in: number; out: number }> = {
  "gemini-2.5-flash-lite": { in: 0.10, out: 0.40 },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.50 },
};

/**
 * Adaptador Gemini con el mismo contrato que `claudeHaiku()`. Reusa `generate()` de
 * `../venezuela/gemini.ts` (el mismo fetch, retry y usage que ya usan los bots de VE y de
 * customer en produccion con esta llave), asi que aqui no hay una segunda copia del cliente.
 *
 * Salida JSON siempre (`responseMimeType: application/json`), salvo que quien llama pida
 * `plainText`. Temperatura 0 por defecto: es un lector, no un entrevistador.
 */
export function geminiFlashLite(modelId: string = GEMINI_LECTOR_MODELO): ModelAdapter {
  const pricing = PRECIOS_GEMINI[modelId];
  if (!pricing) throw new Error(`geminiFlashLite: "${modelId}" no tiene precio registrado en PRECIOS_GEMINI`);
  return {
    id: modelId,
    pricing,
    async call(opts: ModelCallOpts): Promise<ModelResult> {
      const messages = opts.messages.map((m: ModelMessage) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        text: m.content,
      }));
      const r = await generate({
        model: modelId,
        system: opts.system,
        messages,
        temperature: opts.temperature ?? 0,
        maxOutputTokens: opts.maxTokens ?? 1024,
        // Pensamiento apagado en la familia 2.5 (`thinkingBudget: 0`, la sintaxis de esa familia).
        // En la 3.x ese parametro se ignora en silencio y el control es `thinking_level`; la doc
        // oficial no lo lista para `gemini-3.1-flash-lite`, asi que no se manda nada, igual que
        // en `meta-leads/entender-formulario.ts`.
        ...(modelId.startsWith("gemini-2.5") ? { thinkingBudget: 0 } : {}),
        jsonMime: !opts.plainText,
      });
      // Los tokens de pensamiento se cobran como salida (asi lo dice el pricing): van en `out`.
      return { text: r.text, usage: { in: r.usage.in, out: r.usage.out + r.usage.thoughts } };
    },
  };
}
