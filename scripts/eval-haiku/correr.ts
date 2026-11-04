/**
 * Eval de Claude Haiku 5.5 con casos reales de producción (Mauricio, 2026-10-20).
 *
 * Uso:
 *   npx tsx --conditions=react-server scripts/eval-haiku/correr.ts [--mock] [--demo] [--familia gastos,rut] [--limite 20] [--paralelo 4] [--caso bloqueo]
 *
 *   --caso     solo los casos cuyo id contiene ese texto (p. ej. «bloqueo»).
 *   --paralelo casos a la vez dentro de cada familia (por defecto 1). La medición de cada llamada va por caso igual.
 *   trappvel_conversacion y trappvel_captura leen sus casos del banco de la QA de Trappvel (`TRAPPVEL_QA_DIR`), no de
 *   casos/: ver `trappvel.ts`.
 *
 *   --mock     modelo simulado (sin llave, sin gasto): prueba la cañería, no mide calidad.
 *   --demo     casos de demostración en memoria (sin base ni Drive). Sin --demo lee scripts/eval-haiku/casos/*.json,
 *              que salen de consultas.sql (SOLO SELECT) y están en .gitignore.
 *
 * Necesita `ANTHROPIC_API_KEY` en `.env.local` del worktree (o en el entorno). Para bajar archivos (documento, rut) y
 * transcripciones (acta) usa además NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY y las credenciales de Drive
 * de la app, solo para LEER: `entorno.ts` responde 403 a toda escritura contra Supabase y lanza ante cualquier URL de
 * Gemini.
 *
 * Reporta por familia: aciertos por campo, JSON válido, latencia (p50 / p95 por llamada al modelo) y costo estimado
 * con el precio de Haiku 5.5 (USD 0,10 / 0,50 por MTok). Escribe el detalle en scripts/eval-haiku/resultados/.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

import { blindarFetch, cargarEntorno, llamadasBloqueadas, permitirServerOnly } from './entorno'
import { fetchSimulado } from './mock'
import { CASOS_DEMO, FAMILIAS, type Caso, type Contexto, type ResultadoFamilia } from './familias'
import { casosTrappvel } from './trappvel'
import { costoUsd, MODELO_HAIKU } from '../../supabase/functions/_shared/llm-anthropic'

const args = process.argv.slice(2)
const arg = (k: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const MOCK = args.includes('--mock')
const DEMO = args.includes('--demo')
const SOLO = arg('--familia')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null
const LIMITE = Number(arg('--limite') ?? 0) || Infinity
const PARALELO = Math.max(1, Number(arg('--paralelo') ?? 1) || 1)
const CASO = arg('--caso') ?? null
const DIR = __dirname

cargarEntorno()
permitirServerOnly()
if (MOCK) process.env.ANTHROPIC_API_KEY = 'mock'
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Falta ANTHROPIC_API_KEY (en .env.local del worktree o en el entorno). Para probar sin llave: --mock.')
  process.exit(2)
}

// ── Medición de cada llamada al modelo ───────────────────────────────────────

interface Llamada { caso: string; ms: number; estado: number; entrada: number; salida: number; jsonValido: boolean; stop: string | null; esquema: 'estricto' | 'en_sistema' | 'sin_esquema'; esfuerzo: string | null; error?: string }
const llamadas: Llamada[] = []
const casoEnCurso = new AsyncLocalStorage<string>()

function medir(base: typeof fetch): typeof fetch {
  return (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
    if (!url.startsWith('https://api.anthropic.com/')) return base(entrada, init)
    // Cómo viajó el esquema: salida estructurada, dicho en el sistema (sin garantía de forma) o sin esquema.
    let esquema: Llamada['esquema'] = 'sin_esquema'
    let esfuerzo: string | null = null
    try {
      const b = JSON.parse(String(init?.body ?? '{}')) as { system?: string; output_config?: { format?: unknown; effort?: string } }
      esquema = b.output_config?.format ? 'estricto' : /JSON Schema/.test(b.system ?? '') ? 'en_sistema' : 'sin_esquema'
      esfuerzo = b.output_config?.effort ?? null
    } catch { /* cuerpo raro */ }
    const t0 = performance.now()
    const res = await base(entrada, init)
    const ms = Math.round(performance.now() - t0)
    const copia = await res.clone().text()
    let entradaT = 0, salidaT = 0, jsonValido = false, stop: string | null = null
    try {
      const d = JSON.parse(copia) as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }; content?: Array<{ type: string; text?: string }>; stop_reason?: string }
      entradaT = (d.usage?.input_tokens ?? 0) + (d.usage?.cache_read_input_tokens ?? 0)
      salidaT = d.usage?.output_tokens ?? 0
      stop = d.stop_reason ?? null
      const texto = (d.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
      const conHerramienta = (d.content ?? []).some((b) => b.type === 'tool_use')
      if (conHerramienta) jsonValido = true
      else if (texto) {
        try { JSON.parse(texto); jsonValido = true } catch { jsonValido = false }
      }
    } catch { /* respuesta que no es JSON */ }
    llamadas.push({ caso: casoEnCurso.getStore() ?? '', ms, estado: res.status, entrada: entradaT, salida: salidaT, jsonValido, stop, esquema, esfuerzo, ...(res.ok ? {} : { error: copia.slice(0, 300) }) })
    return res
  }) as typeof fetch
}

const red = blindarFetch(globalThis.fetch)
globalThis.fetch = medir(MOCK ? fetchSimulado(red) : red)

// ── Archivos (solo lectura) ─────────────────────────────────────────────────

const ctx: Contexto = {
  async leerArchivo(e) {
    const mime = String(e.mime ?? 'application/pdf')
    if (typeof e.archivo_base64 === 'string') return { buffer: Buffer.from(e.archivo_base64, 'base64'), mime }
    if (typeof e.drive_file_id === 'string' && e.drive_file_id) {
      const { downloadDriveFile } = await import('../../src/lib/google-drive')
      return { buffer: await downloadDriveFile(e.drive_file_id, e.workspace_id as string | undefined), mime }
    }
    const ref = typeof e.drive_url === 'string' && e.drive_url.startsWith('one://') ? e.drive_url.slice(6) : null
    const bucket = (e.bucket as string) ?? ref?.split('/')[0]
    const ruta = (e.path as string) ?? ref?.split('/').slice(1).join('/')
    if (!bucket || !ruta) throw new Error('el caso no dice dónde está el archivo')
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    const { data, error } = await sb.storage.from(bucket).download(ruta)
    if (error || !data) throw new Error(`no se pudo bajar ${bucket}/…: ${error?.message ?? 'vacío'}`)
    return { buffer: Buffer.from(await data.arrayBuffer()), mime: data.type || mime }
  },
  async leerTextoDrive(fileId, workspaceId) {
    const { exportGoogleDocAsText } = await import('../../src/lib/google-drive')
    return exportGoogleDocAsText(fileId, workspaceId)
  },
}

// ── Casos ───────────────────────────────────────────────────────────────────

function cargarCasos(): Caso[] {
  if (DEMO) return CASOS_DEMO
  const dir = path.join(DIR, 'casos')
  const deLaBase = existsSync(dir)
    ? readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .flatMap((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Caso[])
    : []
  const todos = [...deLaBase, ...casosTrappvel(SOLO)]
  if (!todos.length) {
    console.error(`No hay casos en ${dir} ni el banco de Trappvel. Sácalos con consultas.sql (SOLO SELECT) o corre --demo.`)
    process.exit(2)
  }
  return todos
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

async function main() {
  const todos = cargarCasos().filter((c) => (!SOLO || SOLO.includes(c.familia)) && (!CASO || c.id.includes(CASO)))
  const porFamilia = new Map<string, Caso[]>()
  for (const c of todos) {
    const l = porFamilia.get(c.familia) ?? []
    if (l.length < LIMITE) l.push(c)
    porFamilia.set(c.familia, l)
  }
  const detalle: Array<Caso & { resultado: ResultadoFamilia; llamadas: Llamada[] }> = []
  const filas: string[] = []
  const porCampos: string[] = []
  for (const [familia, casos] of porFamilia) {
    const correr = FAMILIAS[familia]
    if (!correr) {
      console.warn(`familia sin corrida: ${familia} (${casos.length} casos)`)
      continue
    }
    const pendientes = [...casos]
    const uno = async (c: Caso) => {
      const clave = `${familia}:${c.id}`
      let resultado: ResultadoFamilia
      try {
        resultado = await casoEnCurso.run(clave, () => correr(c, ctx))
      } catch (e) {
        resultado = { campos: [], error: String((e as Error)?.message ?? e).slice(0, 300) }
      }
      detalle.push({ ...c, resultado, llamadas: llamadas.filter((l) => l.caso === clave) })
      process.stdout.write(resultado.error ? 'E' : resultado.noAplica ? '-' : resultado.campos.every((x) => x.ok) ? '.' : 'x')
    }
    await Promise.all(Array.from({ length: Math.min(PARALELO, pendientes.length) }, async () => {
      for (let c = pendientes.shift(); c; c = pendientes.shift()) await uno(c)
    }))
    const d = detalle.filter((x) => x.familia === familia)
    const ll = llamadas.filter((l) => l.caso.startsWith(`${familia}:`))
    const campos = d.flatMap((x) => x.resultado.campos)
    const humanos = campos.filter((x) => x.corregidoPorHumano)
    const evaluados = d.filter((x) => !x.resultado.noAplica)
    const casosOk = evaluados.filter((x) => !x.resultado.error && x.resultado.campos.every((k) => k.ok)).length
    const tin = ll.reduce((s, l) => s + l.entrada, 0)
    const tout = ll.reduce((s, l) => s + l.salida, 0)
    filas.push([
      familia,
      `${evaluados.length}/${d.length}`,
      `${casosOk}/${evaluados.length}`,
      `${campos.filter((x) => x.ok).length}/${campos.length}`,
      humanos.length ? `${humanos.filter((x) => x.ok).length}/${humanos.length}` : '—',
      `${ll.filter((l) => l.jsonValido).length}/${ll.length}`,
      `${d.filter((x) => x.resultado.error).length}`,
      `${pct(ll.map((l) => l.ms), 50)} / ${pct(ll.map((l) => l.ms), 95)}`,
      `$${costoUsd(tin, tout).toFixed(4)} (${tin}/${tout})`,
    ].join(' | '))
    // Aciertos por nombre de campo: dice QUÉ falla, no solo cuánto.
    const porCampo = new Map<string, [number, number]>()
    for (const k of campos) {
      const a = porCampo.get(k.campo) ?? [0, 0]
      porCampo.set(k.campo, [a[0] + (k.ok ? 1 : 0), a[1] + 1])
    }
    if (porCampo.size > 1) porCampos.push(`${familia}: ${[...porCampo].map(([k, [ok, n]]) => `${k} ${ok}/${n}`).join(' · ')}`)
  }
  process.stdout.write('\n\n')
  console.log(`Modelo: ${MOCK ? 'SIMULADO (--mock)' : MODELO_HAIKU}${DEMO ? ' · casos de demostración' : ''}`)
  console.log('familia | casos evaluados | casos 100% | aciertos por campo | campos corregidos por humano | JSON válido (llamadas) | errores | latencia p50/p95 ms | costo USD (tokens in/out)')
  for (const f of filas) console.log(f)
  if (porCampos.length) console.log(`\nAciertos por campo:\n${porCampos.map((x) => `  ${x}`).join('\n')}`)
  const fallos = detalle.filter((x) => x.resultado.error || x.resultado.campos.some((k) => !k.ok))
  if (fallos.length) {
    console.log('\nFallos (sin valores del caso: el detalle completo queda en resultados/, fuera del repo):')
    for (const x of fallos) {
      // Los casos de Trappvel son ficticios (banco de la QA): ahí sí se muestran los valores.
      const ficticio = x.familia.startsWith('trappvel_')
      const malos = x.resultado.campos.filter((k) => !k.ok)
        .map((k) => (ficticio ? `${k.campo} (esperado ${JSON.stringify(k.esperado)}, salió ${JSON.stringify(k.obtenido)})` : k.campo))
      console.log(`  ${x.familia}:${x.id} — ${x.resultado.error ?? `campos: ${malos.join(', ')}`}`)
    }
  }
  if (llamadasBloqueadas.length) console.log(`\n⚠ ${llamadasBloqueadas.length} pedidos quisieron ir a Gemini y se bloquearon (no se tradujeron).`)
  mkdirSync(path.join(DIR, 'resultados'), { recursive: true })
  const salida = path.join(DIR, 'resultados', `${new Date().toISOString().replace(/[:.]/g, '-')}${MOCK ? '-mock' : ''}.json`)
  writeFileSync(salida, JSON.stringify({ modelo: MOCK ? 'mock' : MODELO_HAIKU, filas, detalle, llamadasBloqueadas }, null, 2))
  console.log(`\nDetalle: ${path.relative(process.cwd(), salida)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
