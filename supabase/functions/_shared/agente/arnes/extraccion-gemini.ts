// ============================================================
// Arnés del núcleo — la extracción de una carga con el modelo real (Deno)
// ------------------------------------------------------------
// La misma llamada que hace producción en `prepararCarga` (`leerConModelo` de `wa-entendimiento.ts`): misma temperatura,
// mismo esquema y el mismo formato de los mensajes. Se copia aquí para no cargar el flujo viejo de la bandeja (que trae
// Supabase) en el arnés. La llave llega por GEMINI_API_KEY y nunca se imprime: en el
// arnés es la de PRUEBAS.
// ============================================================

import { fetchModelo } from '../../llm-anthropic.ts';
import { esquemaCarga, esquemaCargaCompacta } from '../bandeja/extraccion.ts';
import { mensajesDeTextos } from '../bandeja/carga.ts';
import { textoParaModelo } from '../../wa-guardianes.ts';
import type { ExtractorMemoria } from '../memoria.ts';

/**
 * Producción extrae con `gemini-2.5-flash-lite` (el defecto de `wa-entendimiento.ts`; no hay secreto que lo cambie, medido
 * el 2026-10-09). La llave de pruebas no lo alcanza: Google responde 404 «no longer available to new users» y recomienda
 * `gemini-3.5-flash-lite`. El arnés usa ese (o `ARNES_MODELO_EXTRACCION`): lo que mide es el prompt, en un modelo vecino.
 */
export const MODELO_EXTRACCION = Deno.env.get('ARNES_MODELO_EXTRACCION') || 'gemini-3.5-flash-lite';

/** Lo que se mide de cada llamado: tiempo y tokens (la latencia de flash-lite va casi toda en los de salida). */
export interface MedidaExtraccion { ms: number; ok: boolean; salida?: number; entrada?: number; razonamiento?: number }

/**
 * `compacta`: el esquema de `esquemaCargaCompacta` (las instrucciones las arma quien llama, con `{ compacta }`). El
 * `perfil` lo dice quien arma las instrucciones (el bot siempre lo pide): esquema e instrucciones van juntos.
 */
export function extraccionGemini(llave: string, registro: MedidaExtraccion[] = [], o: { compacta?: boolean } = {}): ExtractorMemoria {
  return async ({ textos, campos, instrucciones, perfil }) => {
    const t0 = performance.now();
    const res = await fetchModelo(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_EXTRACCION}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': llave },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: instrucciones }] },
        contents: [{ role: 'user', parts: [{ text: `Mensajes:\n${textoParaModelo(mensajesDeTextos(textos))}` }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json', responseSchema: o.compacta ? esquemaCargaCompacta(campos, { perfil }) : esquemaCarga(campos, { perfil }) },
      }),
    });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) { registro.push({ ms, ok: false }); throw new Error(`extracción HTTP ${res.status}`); }
    const d = await res.json();
    const txt = d.candidates?.[0]?.content?.parts?.[0]?.text;
    const u = d.usageMetadata ?? {};
    registro.push({ ms, ok: !!txt, salida: Number(u.candidatesTokenCount ?? 0), entrada: Number(u.promptTokenCount ?? 0), razonamiento: Number(u.thoughtsTokenCount ?? 0) });
    if (!txt) throw new Error('extracción vacía');
    return JSON.parse(txt);
  };
}
