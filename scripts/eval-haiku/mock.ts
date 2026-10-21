/**
 * El modelo simulado del arnés (`--mock`): contesta como la API de Mensajes de Anthropic con un JSON que cumple el
 * esquema pedido (primer valor del enum, cadena vacía, 0, false, null). Sirve para probar la cañería entera sin llave
 * y sin gastar: no mide calidad.
 */

type Esq = Record<string, unknown>

export function muestraDeEsquema(e: unknown): unknown {
  if (!e || typeof e !== 'object') return null
  const s = e as Esq
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0]
  if (Array.isArray(s.anyOf) && s.anyOf.length) return muestraDeEsquema(s.anyOf[0])
  const tipo = Array.isArray(s.type) ? s.type[0] : s.type
  switch (tipo) {
    case 'object':
      return Object.fromEntries(Object.entries((s.properties ?? {}) as Esq).map(([k, v]) => [k, muestraDeEsquema(v)]))
    case 'array':
      return []
    case 'string':
      return ''
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    default:
      return null
  }
}

export function respuestaSimulada(cuerpo: Record<string, unknown>): Record<string, unknown> {
  const tools = cuerpo.tools as Array<{ name: string; input_schema: unknown }> | undefined
  const usage = { input_tokens: Math.round(JSON.stringify(cuerpo).length / 4), output_tokens: 20 }
  if (tools?.length) {
    return { content: [{ type: 'tool_use', id: 'toolu_mock', name: tools[0].name, input: muestraDeEsquema(tools[0].input_schema) }], stop_reason: 'tool_use', usage, model: 'mock' }
  }
  const esquema = ((cuerpo.output_config as Esq | undefined)?.format as Esq | undefined)?.schema
  const texto = JSON.stringify(esquema ? muestraDeEsquema(esquema) : {})
  return { content: [{ type: 'text', text: texto }], stop_reason: 'end_turn', usage, model: 'mock' }
}

/** Un fetch que contesta a api.anthropic.com con la respuesta simulada; el resto pasa a `base`. */
export function fetchSimulado(base: typeof fetch): typeof fetch {
  return (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
    if (url.startsWith('https://api.anthropic.com/')) {
      const cuerpo = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return new Response(JSON.stringify(respuestaSimulada(cuerpo)), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return base(entrada, init)
  }) as typeof fetch
}
