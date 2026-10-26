/**
 * Entorno del arnés de `scripts/eval-haiku/`: carga `.env.local` del worktree (y, de respaldo, el del repo
 * principal) SIN imprimir nada, y bloquea por construcción dos cosas que el eval no puede hacer:
 *   · llamar a Gemini (cualquier URL de generativelanguage.googleapis.com lanza);
 *   · escribir en Supabase (todo lo que no sea GET/HEAD contra *.supabase.co responde 403).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const RAIZ = path.resolve(__dirname, '../..')

function cargarArchivo(ruta: string) {
  if (!existsSync(ruta)) return
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const [, k, crudo] = m
    if (process.env[k]) continue
    process.env[k] = crudo.replace(/^['"]|['"]$/g, '')
  }
}

export function cargarEntorno() {
  cargarArchivo(path.join(RAIZ, '.env.local'))
  // Worktree en .claude/worktrees/<x>: el principal está 3 niveles arriba.
  cargarArchivo(path.resolve(RAIZ, '../../../.env.local'))
  process.env.LLM_PROVEEDOR = 'anthropic'
  // El eval mide Haiku también en las familias que en producción siguen en Gemini por defecto.
  process.env.LLM_PROVEEDOR_DOCUMENTOS = 'anthropic'
  process.env.LLM_PROVEEDOR_ACTAS = 'anthropic'
}

export const llamadasBloqueadas: string[] = []

/** Envuelve `globalThis.fetch`: sin Gemini, sin escrituras en Supabase. */
export function blindarFetch(base: typeof fetch = globalThis.fetch) {
  const blindado = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
    if (url.includes('generativelanguage.googleapis.com')) {
      llamadasBloqueadas.push(url.replace(/key=[^&]+/, 'key=***'))
      throw new Error('eval-haiku: llamada a Gemini bloqueada (el pedido no se tradujo a Anthropic)')
    }
    const metodo = (init?.method ?? (entrada instanceof Request ? entrada.method : 'GET')).toUpperCase()
    if (url.includes('.supabase.co') && metodo !== 'GET' && metodo !== 'HEAD') {
      return new Response(JSON.stringify({ message: 'eval-haiku: escritura bloqueada' }), { status: 403 })
    }
    return base(entrada, init)
  }
  globalThis.fetch = blindado as typeof fetch
  return blindado
}
