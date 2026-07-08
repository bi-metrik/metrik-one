// Adaptador Gemini para el bot de escucha "Voz de Venezuela" (Cardumen, despliegue standalone).
// Portado VERBATIM del harness de eval (eval/gemini.ts); unico cambio: la key sale de Deno.env
// en vez de process.env. Mismo patron: fetch nativo, usageMetadata, retry con backoff, thinking OFF.

export interface GenUsage {
  in: number;        // promptTokenCount
  out: number;       // candidatesTokenCount
  thoughts: number;  // thoughtsTokenCount (debe ser 0 con thinkingBudget:0)
  total: number;     // totalTokenCount
}
export interface GenResult { text: string; usage: GenUsage; raw?: unknown }

export interface Msg { role: "user" | "model"; text: string }

export interface CallOpts {
  model: string;
  system: string;
  messages: Msg[];
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;   // 0 = thinking OFF (palanca de costo del bot; obligatorio en prod)
  jsonMime?: boolean;
}

// Reintento con backoff exponencial para 429/503/500/UNAVAILABLE.
async function withRetry<T>(fn: () => Promise<T>, tries = 6, baseMs = 1200): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = (e as Error).message ?? "";
      const transient = /\b(429|503|500|502|504|UNAVAILABLE|overloaded|high demand|RESOURCE_EXHAUSTED|internal)\b/i.test(msg);
      if (!transient || i === tries - 1) throw e;
      const delay = Math.min(baseMs * 2 ** i, 15000) + Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function generate(opts: CallOpts): Promise<GenResult> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY no esta en el entorno");

  const contents = opts.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));

  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.7,
    maxOutputTokens: opts.maxOutputTokens ?? 256,
  };
  if (opts.thinkingBudget !== undefined) {
    generationConfig.thinkingConfig = { thinkingBudget: opts.thinkingBudget };
  }
  if (opts.jsonMime) generationConfig.responseMimeType = "application/json";

  const body: Record<string, unknown> = {
    contents,
    systemInstruction: { parts: [{ text: opts.system }] },
    generationConfig,
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${key}`;

  const data: any = await withRetry(async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    return res.json();
  });

  const text: string =
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  const um = data?.usageMetadata ?? {};
  const usage: GenUsage = {
    in: um.promptTokenCount ?? 0,
    out: um.candidatesTokenCount ?? 0,
    thoughts: um.thoughtsTokenCount ?? 0,
    total: um.totalTokenCount ?? 0,
  };
  return { text, usage, raw: data };
}
