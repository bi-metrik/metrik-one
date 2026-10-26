import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// wa-transcribe lee `Deno.env` al cargar: se simula antes del import.
;(globalThis as unknown as { Deno?: unknown }).Deno ??= { env: { get: (k: string) => (k === 'GEMINI_API_KEY' ? 'g' : undefined) } }

vi.mock('./wa-media.ts', () => ({
  getMediaUrl: vi.fn(async () => 'https://meta.example/audio'),
  downloadMediaBinary: vi.fn(async () => ({ buffer: new Uint8Array([1, 2, 3]), rawMimeType: 'audio/ogg; codecs=opus', sizeKB: 1 })),
}))

const { transcribeAudio, MAX_SALIDA_TRANSCRIPCION } = await import('./wa-transcribe.ts')

function gemini(finishReason: string | undefined, text = 'hola, esto es la mitad de') {
  const f = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({
    candidates: [{ finishReason, content: { parts: [{ text }] } }],
  })))
  vi.stubGlobal('fetch', f)
  return f
}

const cuerpo = (f: ReturnType<typeof gemini>) => JSON.parse(String(f.mock.calls[0][1].body))

describe('transcribeAudio sin opciones no acepta media transcripción', () => {
  beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('pide la salida amplia, no 512', async () => {
    const f = gemini('STOP')
    await transcribeAudio('a1')
    expect(MAX_SALIDA_TRANSCRIPCION).toBeGreaterThanOrEqual(8192)
    expect(cuerpo(f).generationConfig.maxOutputTokens).toBe(MAX_SALIDA_TRANSCRIPCION)
  })

  it('un corte por tope de salida devuelve error, no el texto cortado', async () => {
    gemini('MAX_TOKENS')
    expect(await transcribeAudio('a1')).toEqual({ text: null, error: 'GEMINI_INCOMPLETO: finishReason MAX_TOKENS' })
  })

  it('sin finishReason tampoco se da por completa', async () => {
    gemini(undefined)
    expect((await transcribeAudio('a1')).text).toBeNull()
  })

  it('con STOP entrega el texto', async () => {
    gemini('STOP', 'nota completa')
    expect(await transcribeAudio('a1')).toEqual({ text: 'nota completa' })
  })
})

// Guarda de regresión: ninguna ruta puede volver a pedir poca salida ni apagar la exigencia de fin.
describe('ninguna llamada a transcribeAudio rebaja la protección', () => {
  const raiz = 'supabase/functions'
  const fuentes: string[] = []
  const recorrer = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) recorrer(p)
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('wa-transcribe.ts')) fuentes.push(p)
    }
  }
  recorrer(raiz)

  const llamadas = fuentes.flatMap((p) => {
    const s = readFileSync(p, 'utf8')
    const out: { p: string; args: string }[] = []
    for (let i = s.indexOf('transcribeAudio('); i > -1; i = s.indexOf('transcribeAudio(', i + 1)) {
      // Argumentos hasta el paréntesis que cierra la llamada.
      let prof = 0, j = i + 'transcribeAudio'.length
      for (; j < s.length; j++) { if (s[j] === '(') prof++; else if (s[j] === ')' && --prof === 0) break }
      out.push({ p, args: s.slice(i, j + 1) })
    }
    return out
  }).filter((c) => !/^transcribeAudio\(\s*\w+\s*:/.test(c.args)) // descarta firmas

  it('encuentra las rutas (wa-webhook, Cardumen, Agus, bandeja)', () => {
    const archivos = new Set(llamadas.map((c) => c.p))
    for (const a of ['wa-webhook/index.ts', 'cardumen/objetos-flujo.ts', '_shared/wa-agente.ts', '_shared/wa-bandeja.ts']) {
      expect([...archivos].some((p) => p.endsWith(a)), a).toBe(true)
    }
  })

  it.each(['exigirFinCompleto: false', 'exigirFinCompleto:false'])('ninguna pasa %s', (patron) => {
    expect(llamadas.filter((c) => c.args.includes(patron))).toEqual([])
  })

  it('ninguna pide menos salida que el valor por defecto', () => {
    const bajas = llamadas.filter((c) => {
      const m = c.args.match(/maxOutputTokens\s*:\s*([^,}\s]+)/)
      return m && !(Number(m[1]) >= MAX_SALIDA_TRANSCRIPCION || m[1] === 'MAX_SALIDA_TRANSCRIPCION')
    })
    expect(bajas).toEqual([])
  })
})
