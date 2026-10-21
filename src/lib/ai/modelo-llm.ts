/**
 * El punto único del modelo de lenguaje en Next (Mauricio, 2026-10-20: Gemini → Claude Haiku 5.5).
 *
 * Los sitios que hoy arman un pedido de Gemini cambian `fetch(urlGemini, init)` por `fetchModelo(urlGemini, init)`:
 * con `LLM_PROVEEDOR` en `anthropic` (por defecto) y `ANTHROPIC_API_KEY` en el entorno, el pedido va a
 * `claude-haiku-5-5` y vuelve con la forma de Gemini; con `LLM_PROVEEDOR=gemini`, o sin la llave, sale a Gemini
 * como siempre. La traducción vive en `supabase/functions/_shared/llm-anthropic.ts` y es la MISMA que usa el edge:
 * un solo traductor para los dos runtimes, y el arnés de `scripts/eval-haiku/` prueba exactamente ese código.
 *
 * Por qué no `@ai-sdk/anthropic` (que sí usa `src/lib/proveedores/motor.ts`): los sitios hablan la API REST de
 * Gemini en crudo (esquema OpenAPI, `finishReason`, `promptFeedback`), y pasar por el SDK obligaría a traducir dos
 * veces y a tener un camino distinto en Next y en el edge.
 *
 * Los dos sitios de AUDIO (`calidad/transcribir.ts` y `_shared/wa-transcribe.ts`) NO pasan por aquí: Haiku 5.5 no
 * recibe audio.
 *
 * Sin `import 'server-only'` a propósito: varios sitios exportan tipos y constantes que también importa el cliente, y
 * este módulo no guarda secretos (lee `ANTHROPIC_API_KEY` en cada llamada, que en el navegador no existe).
 */

export {
  fetchModelo,
  fetchModeloDocumentos,
  fetchModeloActas,
  crearFetchModelo,
  proveedorLLM,
  MODELO_HAIKU,
  PRECIO_HAIKU,
  costoUsd,
} from '../../../supabase/functions/_shared/llm-anthropic.ts'
