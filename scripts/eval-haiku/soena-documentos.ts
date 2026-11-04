/**
 * Eval SOE-038: lectura de documentos reales de SOENA con `extractFieldsFromDocument` (el código de producción),
 * con Haiku 5.5 o con Gemini, sobre los mismos casos.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.json --conditions=react-server scripts/eval-haiku/soena-documentos.ts \
 *     [--proveedor anthropic|gemini] [--solo id1,id2] [--tipo rut,factura_venta_vehiculo] [--salida nombre]
 *
 * Casos: `casos/soena-documentos.json` (gitignored: datos de clientes). Cada caso trae los `campos_extraccion` del
 * bloque, el archivo de Drive y el oráculo (lo que quedó guardado en producción).
 *
 * Solo lectura: `entorno.ts` responde 403 a toda escritura contra Supabase. Con `--proveedor gemini` la ÚNICA llave
 * de Gemini que sale es la de PRUEBAS, leída de `GEMINI_LLAVE_PRUEBAS_ARCHIVO`; cualquier otra URL de Gemini (la
 * llave de producción del `.env.local`, por ejemplo) lanza. Así el eval no gasta la cuota de producción.
 *
 * `--modelo-gemini <id>` cambia el modelo de Gemini del pedido (solo en el eval).
 *
 * Escribe en `resultados/soena-<salida>.json` el detalle por campo y la respuesta cruda del modelo por caso.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { blindarFetch, cargarEntorno, llamadasBloqueadas } from './entorno'
import { comparar } from './comparar'
import type { CampoExtraccion } from '../../src/lib/ai/extract-fields'

const args = process.argv.slice(2)
const arg = (k: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const PROVEEDOR = arg('--proveedor') === 'gemini' ? 'gemini' : 'anthropic'
const SOLO = arg('--solo')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null
const TIPOS = arg('--tipo')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null
const SALIDA = arg('--salida') ?? PROVEEDOR
/** El proyecto de la llave de pruebas ya no tiene `gemini-2.5-flash` (404 «no longer available to new users»). */
const MODELO_GEMINI = arg('--modelo-gemini')
/**
 * `--descripciones <json>`: { tipo: { slug: descripcion_ai } } que reemplaza la de `campos_extraccion` (el texto vive en
 * `bloque_configs.config_extra` de producción; así se mide antes de proponer el cambio).
 */
const DESCRIPCIONES = arg('--descripciones')
/** `--casos <archivo>` dentro de `casos/` (por defecto `soena-documentos.json`). */
const CASOS = arg('--casos') ?? 'soena-documentos.json'
const DIR = __dirname

interface Llamada { caso: string; estado: number; ms: number; entrada: number; salida: number; crudo: string }
const llamadas: Llamada[] = []
const caso = new AsyncLocalStorage<string>()

async function main() {
  cargarEntorno()
  let llavePruebas = ''
  if (PROVEEDOR === 'gemini') {
    const archivo = process.env.GEMINI_LLAVE_PRUEBAS_ARCHIVO
    if (!archivo) throw new Error('Falta GEMINI_LLAVE_PRUEBAS_ARCHIVO (la llave de pruebas de Gemini, nunca la de producción)')
    llavePruebas = readFileSync(archivo, 'utf8').trim()
    console.log(`Gemini con la llave de pruebas (sha256 ${createHash('sha256').update(llavePruebas).digest('hex').slice(0, 8)})`)
    process.env.LLM_PROVEEDOR_DOCUMENTOS = 'gemini'
  }

  const blindado = blindarFetch(globalThis.fetch)
  const original = blindado
  const base = PROVEEDOR === 'gemini'
    ? (async (e: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof e === 'string' ? e : e instanceof URL ? e.href : e.url
        if (!url.includes('generativelanguage.googleapis.com')) return original(e, init)
        if (new URL(url).searchParams.get('key') !== llavePruebas) throw new Error('eval: Gemini solo con la llave de pruebas')
        return realFetch(MODELO_GEMINI ? url.replace(/models\/[^:]+:/, `models/${MODELO_GEMINI}:`) : url, init)
      }) as typeof fetch
    : original

  globalThis.fetch = (async (e: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.href : e.url
    const esModelo = url.startsWith('https://api.anthropic.com/') || url.includes('generativelanguage.googleapis.com')
    if (!esModelo) return base(e, init)
    const t0 = performance.now()
    const r = await base(e, init)
    const txt = await r.clone().text()
    let entrada = 0, salida = 0, crudo = txt.slice(0, 4000)
    try {
      const d = JSON.parse(txt)
      if (d.usage) {
        entrada = (d.usage.input_tokens ?? 0) + (d.usage.cache_read_input_tokens ?? 0)
        salida = d.usage.output_tokens ?? 0
        crudo = (d.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('')
      } else if (d.usageMetadata) {
        entrada = d.usageMetadata.promptTokenCount ?? 0
        salida = (d.usageMetadata.candidatesTokenCount ?? 0) + (d.usageMetadata.thoughtsTokenCount ?? 0)
        crudo = (d.candidates?.[0]?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? '').join('')
      }
    } catch { /* no JSON */ }
    llamadas.push({ caso: caso.getStore() ?? '', estado: r.status, ms: Math.round(performance.now() - t0), entrada, salida, crudo })
    return r
  }) as typeof fetch

  const { extractFieldsFromDocument } = await import('../../src/lib/ai/extract-fields')
  const { aplicarNormalizaciones } = await import('../../src/lib/documentos/normalizaciones')
  const { downloadDriveFile } = await import('../../src/lib/google-drive')
  // La misma política de reintento de producción (`documento-actions.ts`).
  const { extraerConReintento } = await import('../../src/lib/ai/reintentar-extraccion')

  type Caso = {
    id: string
    entrada: { workspace_id: string; mime?: string; drive_file_id: string; campos: CampoExtraccion[] }
    oraculo: { campos?: Record<string, { value?: string | null; manual?: boolean }> }
  }
  type CampoMedido = ReturnType<typeof comparar> & { requerido: boolean; confianza: number | null }
  type Detalle = { id: string; tipo: string; ms?: number; error?: string; campos?: CampoMedido[] }
  let casos = JSON.parse(readFileSync(path.join(DIR, 'casos', CASOS), 'utf8')) as Caso[]
  if (SOLO) casos = casos.filter((c) => SOLO.includes(c.id))
  if (TIPOS) casos = casos.filter((c) => TIPOS.includes(c.id.split(':')[0]))

  if (DESCRIPCIONES) {
    const d = JSON.parse(readFileSync(DESCRIPCIONES, 'utf8')) as Record<string, Record<string, string>>
    for (const c of casos) {
      const porSlug = d[c.id.split(':')[0]] ?? {}
      c.entrada.campos = c.entrada.campos.map((k) => (porSlug[k.slug] ? { ...k, descripcion_ai: porSlug[k.slug] } : k))
    }
  }

  const detalle: Detalle[] = []
  const cola = [...casos]
  async function trabajador() {
    for (let c = cola.shift(); c; c = cola.shift()) {
      const tipo = c.id.split(':')[0]
      const t0 = performance.now()
      await caso.run(c.id, async () => {
        try {
          const buffer = await downloadDriveFile(c.entrada.drive_file_id, c.entrada.workspace_id)
          const r = await extraerConReintento(
            () => extractFieldsFromDocument(buffer, c.entrada.mime ?? 'application/pdf', c.entrada.campos, PROVEEDOR === 'gemini' ? llavePruebas : 'sin-gemini'),
            `eval ${c.id}`,
          )
          if (!r.data) { detalle.push({ id: c.id, tipo, error: r.error ?? 'sin datos' }); return }
          aplicarNormalizaciones(c.entrada.campos, r.data)
          const or = c.oraculo.campos ?? {}
          const campos = c.entrada.campos
            .filter((k) => k.slug in or)
            .map((k) => ({
              ...comparar(k.slug, or[k.slug]?.value ?? null, r.data?.[k.slug]?.value ?? null, !!or[k.slug]?.manual),
              requerido: !!k.required,
              confianza: r.data?.[k.slug]?.confidence ?? null,
            }))
          detalle.push({ id: c.id, tipo, ms: Math.round(performance.now() - t0), campos })
        } catch (err) {
          detalle.push({ id: c.id, tipo, error: String((err as Error).message ?? err).slice(0, 200) })
        }
      })
    }
  }
  await Promise.all([1, 2, 3, 4].map(trabajador))

  mkdirSync(path.join(DIR, 'resultados'), { recursive: true })
  writeFileSync(path.join(DIR, `resultados/soena-${SALIDA}.json`), JSON.stringify({ proveedor: PROVEEDOR, detalle, llamadas, bloqueadas: llamadasBloqueadas }, null, 1))

  const f = (xs: CampoMedido[]) => `${xs.filter((x) => x.ok).length}/${xs.length}`
  console.log('tipo | docs | errores | campos ok | requeridos ok | corregidos por humano ok')
  for (const t of [...new Set(detalle.map((d) => d.tipo))].sort()) {
    const ds = detalle.filter((d) => d.tipo === t)
    const cs = ds.flatMap((d) => d.campos ?? [])
    console.log(`${t} | ${ds.length} | ${ds.filter((d) => d.error).length} | ${f(cs)} | ${f(cs.filter((x) => x.requerido))} | ${f(cs.filter((x) => x.corregidoPorHumano))}`)
  }
  const todos = detalle.flatMap((d) => d.campos ?? [])
  console.log(`TOTAL | ${detalle.length} | ${detalle.filter((d) => d.error).length} | ${f(todos)} | ${f(todos.filter((x) => x.requerido))} | ${f(todos.filter((x) => x.corregidoPorHumano))}`)
  const est = llamadas.reduce((a, l) => (a[l.estado] = (a[l.estado] ?? 0) + 1, a), {} as Record<number, number>)
  const ms = llamadas.map((l) => l.ms).sort((a, b) => a - b)
  console.log(`llamadas por estado: ${JSON.stringify(est)} · bloqueadas: ${llamadasBloqueadas.length} · tokens ${llamadas.reduce((a, l) => a + l.entrada, 0)}/${llamadas.reduce((a, l) => a + l.salida, 0)} · p50/p95 ms ${ms[Math.floor(ms.length / 2)]}/${ms[Math.floor(ms.length * 0.95)]}`)
  for (const d of detalle.filter((x) => x.error)) console.log(`ERROR ${d.id}: ${d.error}`)
  for (const d of detalle) for (const c of (d.campos ?? []).filter((x) => !x.ok)) {
    console.log(`  ✗ ${d.id} ${c.campo}: esperado ${JSON.stringify(c.esperado)} · obtenido ${JSON.stringify(c.obtenido)}${c.requerido ? ' [req]' : ''}${c.corregidoPorHumano ? ' [humano]' : ''}`)
  }
}

const realFetch = globalThis.fetch
main().catch((e) => { console.error(e); process.exit(1) })
