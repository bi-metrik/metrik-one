// Adaptador de modelo para Deno (Edge Function). Claude Haiku 4.5 — el modelo tuneado/validado.
// La clave vive en los secrets del edge function (ANTHROPIC_API_KEY), nunca en el cliente.

import type { ModelAdapter, ModelCallOpts, ModelResult, ModelMessage } from "./types.ts";

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
