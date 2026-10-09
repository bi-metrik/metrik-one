// ============================================================
// Arnés del núcleo — la extracción de una carga con el modelo real (Deno)
// ------------------------------------------------------------
// La misma llamada que hace producción en `prepararCarga` (`leerConModelo` de `wa-entendimiento.ts`): mismo modelo por
// defecto, misma temperatura, mismo esquema y el mismo formato de los mensajes. Se copia aquí para no cargar el flujo
// viejo de la bandeja (que trae Supabase) en el arnés. La llave llega por GEMINI_API_KEY y nunca se imprime: en el
// arnés es la de PRUEBAS.
// ============================================================

import { esquemaCarga } from '../bandeja/extraccion.ts';
import { mensajesDeTextos } from '../bandeja/carga.ts';
import { textoParaModelo } from '../../wa-guardianes.ts';
import type { ExtractorMemoria } from '../memoria.ts';

/** El modelo de la extracción en producción: `GEMINI_ENTENDIMIENTO_MODEL` o `GEMINI_PARSE_MODEL`, si no este. */
export const MODELO_EXTRACCION = Deno.env.get('GEMINI_ENTENDIMIENTO_MODEL') || Deno.env.get('GEMINI_PARSE_MODEL') || 'gemini-2.5-flash-lite';

export function extraccionGemini(llave: string, registro: Array<{ ms: number; ok: boolean }> = []): ExtractorMemoria {
  return async ({ textos, campos, instrucciones }) => {
    const t0 = performance.now();
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_EXTRACCION}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': llave },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: instrucciones }] },
        contents: [{ role: 'user', parts: [{ text: `Mensajes:\n${textoParaModelo(mensajesDeTextos(textos))}` }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json', responseSchema: esquemaCarga(campos) },
      }),
    });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) { registro.push({ ms, ok: false }); throw new Error(`extracción HTTP ${res.status}`); }
    const d = await res.json();
    const txt = d.candidates?.[0]?.content?.parts?.[0]?.text;
    registro.push({ ms, ok: !!txt });
    if (!txt) throw new Error('extracción vacía');
    return JSON.parse(txt);
  };
}
