/**
 * Prueba de humo: un pedido de Gemini (con esquema, imagen-less) pasa por el traductor y vuelve de Haiku 5.5.
 * Uso: npx tsx scripts/eval-haiku/humo.ts
 */
import { blindarFetch, cargarEntorno } from './entorno'
import { fetchModelo } from '../../supabase/functions/_shared/llm-anthropic'

cargarEntorno()
blindarFetch()

async function main() {
  const cuerpos: Array<[string, unknown]> = [
    ['esquema', {
      system_instruction: { parts: [{ text: 'Clasifica el gasto.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Almuerzo con cliente en Crepes, $85.000' }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 256, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 },
        responseSchema: { type: 'OBJECT', properties: { categoria: { type: 'STRING', enum: ['alimentacion', 'transporte', 'otros'] }, confianza: { type: 'NUMBER', nullable: true } }, required: ['categoria', 'confianza'] } },
    }],
    ['pensamiento', {
      contents: [{ role: 'user', parts: [{ text: 'Devuelve {"ok":true}' }] }],
      generationConfig: { maxOutputTokens: 2048, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 1024 } },
    }],
    ['herramientas', {
      system_instruction: { parts: [{ text: 'Responde al usuario con la herramienta responder.' }] },
      contents: [{ role: 'user', parts: [{ text: 'hola' }] }],
      tools: [{ functionDeclarations: [{ name: 'responder', parameters: { type: 'OBJECT', properties: { texto: { type: 'STRING' } }, required: ['texto'] } }, { name: 'proponer', parameters: { type: 'OBJECT', properties: { id: { type: 'STRING' } } } }] }],
      toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['responder', 'proponer'] } },
      generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: 'LOW' } },
    }],
  ]
  for (const [nombre, cuerpo] of cuerpos) {
    const t0 = Date.now()
    const res = await fetchModelo('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent', { method: 'POST', body: JSON.stringify(cuerpo) })
    const d = await res.json()
    console.log(nombre, res.status, `${Date.now() - t0} ms`, JSON.stringify(d.candidates?.[0] ?? d.error).slice(0, 300), JSON.stringify(d.usageMetadata ?? {}))
  }
}
main()
