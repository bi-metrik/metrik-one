/**
 * Validacion de punta a punta del motor de auditoria, ANTES de que exista la
 * pantalla.
 *
 * Recorre el camino completo con un audio real y mide cada etapa por separado:
 * transcribir → redactar → auditar → guardar. Si algo no cierra, se sabe aqui y
 * no cuando ya hay una interfaz encima que hay que desarmar.
 *
 * La redaccion corre ENTRE transcribir y auditar, no al final: asi el texto en
 * claro no llega nunca a la auditoria ni, sobre todo, a la base. El auditor
 * sigue viendo la PETICION del agente, que es la evidencia de C1 y C6.
 *
 * Uso:
 *   npx tsx scripts/validar-motor-auditoria.ts <audio.mp3> [--guardar]
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { readFileSync } from 'fs'
import { basename, resolve } from 'path'
import { redactarTranscripcion } from '../src/lib/calidad/redactar'

config({ path: resolve(process.cwd(), '.env.local') })

const MODELO = 'gemini-3.6-flash'
const API_KEY = process.env.GEMINI_API_KEY!
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SLUG = 'regat'

/** Donde vive el prompt de auditoria, calibrado a mano. */
const RUTA_PROMPT =
  '/Users/mauricio/Developer/metrik/proyectos/regat/clarity/docs/entrega/prompt-motor-auditoria.md'

/**
 * Instruccion de transcripcion.
 *
 * Pide el formato exacto que consume el resto del camino y prohibe el preambulo:
 * un "Aqui tienes la transcripcion..." al inicio corre todas las marcas de
 * tiempo y rompe las citas de la auditoria.
 */
const PROMPT_TRANSCRIPCION = `Transcribe este audio de una llamada telefonica de venta.

Formato de salida, una linea por turno y NADA MAS:
[HH:MM:SS] AGENTE: texto
[HH:MM:SS] CLIENTE: texto

Reglas:
- Empieza directamente con el primer turno. Sin preambulo, sin titulo, sin explicaciones.
- La marca de tiempo es el segundo en que EMPIEZA ese turno, medido desde el inicio del audio.
- AGENTE es quien representa a la empresa; CLIENTE es la otra persona.
- Transcribe literal, incluidas muletillas y repeticiones. No resumas ni corrijas la gramatica.
- Si alguien dicta numeros, transcribelos tal como se dicen.
- Si un tramo es inaudible, escribe [inaudible] en su lugar.`

function leerPromptAuditoria(): string {
  const md = readFileSync(RUTA_PROMPT, 'utf-8')
  const m = md.match(/```\n([\s\S]*?)\n```/)
  if (!m) throw new Error('No se encontro el bloque de prompt en el archivo')
  return m[1]
}

async function gemini(partes: unknown[], opts: { json?: boolean } = {}) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: partes }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 32768,
          ...(opts.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    },
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  }
  const c = j.candidates?.[0]
  const texto = c?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!texto) throw new Error(`Respuesta vacia (finishReason: ${c?.finishReason ?? '?'})`)
  return { texto, finish: c?.finishReason }
}

const seg = (ms: number) => `${(ms / 1000).toFixed(1)} s`

async function main() {
  const ruta = process.argv[2]
  const guardar = process.argv.includes('--guardar')
  if (!ruta) throw new Error('Falta la ruta del audio')
  if (!API_KEY) throw new Error('Falta GEMINI_API_KEY')

  const audio = readFileSync(ruta)
  console.log(`audio          ${basename(ruta)} · ${(audio.length / 1024 / 1024).toFixed(1)} MB`)
  console.log(`modelo         ${MODELO}\n`)

  // ── 1. Transcribir ────────────────────────────────────────────────────────
  let t = Date.now()
  const { texto: cruda, finish } = await gemini([
    { text: PROMPT_TRANSCRIPCION },
    { inline_data: { mime_type: 'audio/mpeg', data: audio.toString('base64') } },
  ])
  const tTranscribir = Date.now() - t
  const turnos = cruda.split('\n').filter((l) => /^\s*\[/.test(l)).length
  console.log(`1 transcribir  ${seg(tTranscribir)} · ${turnos} turnos · ${cruda.length} caracteres · finish=${finish}`)
  console.log(`   primera linea: ${cruda.split('\n')[0].slice(0, 90)}`)

  // ── 2. Redactar (determinista, antes de que el texto toque nada) ──────────
  t = Date.now()
  const red = redactarTranscripcion(cruda)
  const tRedactar = Date.now() - t
  console.log(`\n2 redactar     ${seg(tRedactar)} · ${red.total} redacciones ${JSON.stringify(red.conteo)}`)

  // Comprobacion dura: que no quede ninguna racha de digitos en lo que se va a
  // guardar. Es la unica forma de afirmar que la redaccion funciono.
  const fugas = [...red.texto.matchAll(/\b(?:\d[\s.\-–]?){3,}\d\b/g)].map((m) => m[0])
  console.log(`   fugas de digitos en el texto redactado: ${fugas.length}${fugas.length ? ' → ' + fugas.slice(0, 5).join(' | ') : ''}`)

  // ── 3. Auditar (sobre el texto YA redactado) ─────────────────────────────
  t = Date.now()
  const { texto: crudoJson } = await gemini(
    [{ text: `${leerPromptAuditoria()}\n\n---\n\nTranscripcion:\n\n${red.texto}` }],
    { json: true },
  )
  const tAuditar = Date.now() - t
  const auditoria = JSON.parse(crudoJson) as {
    resumen: string
    tecnica: { puntaje: number; bloques: { nombre: string; puntaje: number; maximo: number }[] }
    cumplimiento: {
      semaforo: string
      errores_criticos: number
      // Desde la calibracion del prompt las SEIS banderas vienen siempre, con
      // veredicto presente/ausente. Solo las presentes son hallazgos.
      banderas: { codigo: string; momento: string; hecho: string; presente?: boolean }[]
    }
    conversacion?: Record<string, number>
  }
  const suma = auditoria.tecnica.bloques.reduce((a, b) => a + b.puntaje, 0)
  console.log(`\n3 auditar      ${seg(tAuditar)}`)
  console.log(`   tecnica      ${auditoria.tecnica.puntaje}/100 (suma de bloques ${suma}${suma === auditoria.tecnica.puntaje ? ' ✓' : ' ✗ NO CUADRA'})`)
  console.log(`   semaforo     ${auditoria.cumplimiento.semaforo} · ${auditoria.cumplimiento.errores_criticos} criticas`)
  const presentes = (auditoria.cumplimiento.banderas ?? []).filter((b) => b.presente !== false)
  const ausentes = (auditoria.cumplimiento.banderas ?? []).length - presentes.length
  for (const b of presentes) {
    console.log(`   ${b.codigo} en ${b.momento} · ${b.hecho.slice(0, 84)}`)
  }
  console.log(`   banderas     ${presentes.length} presentes · ${ausentes} descartadas por ausentes`)
  console.log(`   bloques      ${auditoria.tecnica.bloques.map((b) => `${b.puntaje}/${b.maximo}`).join(' · ')}`)

  // Segunda comprobacion: que la auditoria no haya copiado un numero sensible
  // a una cita. El modelo cita textual, asi que si el redactado esta limpio la
  // salida tambien deberia estarlo — pero se verifica, no se supone.
  const fugasJson = [...crudoJson.matchAll(/\b(?:\d[\s.\-–]?){3,}\d\b/g)]
    .map((m) => m[0])
    .filter((s) => !/^\d{1,2}[:.]\d{2}/.test(s))
  console.log(`   fugas de digitos en la auditoria: ${fugasJson.length}${fugasJson.length ? ' → ' + fugasJson.slice(0, 5).join(' | ') : ''}`)

  if (!guardar) {
    console.log(`\ntotal          ${seg(tTranscribir + tRedactar + tAuditar)} (sin guardar)`)
    return
  }

  // ── 4. Guardar ────────────────────────────────────────────────────────────
  t = Date.now()
  const svc = createClient(URL, KEY, { auth: { persistSession: false } })
  const { data: ws } = await svc.from('workspaces').select('id').eq('slug', SLUG).single()
  const workspaceId = (ws as { id: string }).id

  const conv = auditoria.conversacion ?? {}
  const { data: fila, error } = await svc
    .from('calidad_llamadas')
    .insert({
      workspace_id: workspaceId,
      cliente_ref: `MOTOR-${Date.now().toString(36).toUpperCase()}`,
      fecha_hora: new Date().toISOString(),
      direccion: 'entrante',
      duracion_seg: Number(conv.duracion_seg ?? 0),
      agente_nombre: 'Felipe Sandoval',
      puntaje_tecnico: auditoria.tecnica.puntaje,
      semaforo: auditoria.cumplimiento.semaforo,
      habla_agente_pct: conv.habla_agente_pct ?? null,
      habla_cliente_pct: conv.habla_cliente_pct ?? null,
      turnos: conv.turnos ?? null,
      repreguntas: conv.repreguntas_agente ?? null,
      monologos_45s: conv.monologos_45s ?? null,
      detalle_completo: true,
      es_real: true,
      // Rotulo para distinguirla de las sembradas.
      lote: 'motor-auditoria',
      cerro_venta: false,
    })
    .select('id')
    .single()
  if (error) throw new Error(`insert llamada: ${error.message}`)
  const llamadaId = (fila as { id: string }).id

  const bloques = auditoria.tecnica.bloques.map((b, i) => ({
    workspace_id: workspaceId,
    llamada_id: llamadaId,
    orden: i + 1,
    nombre: b.nombre,
    puntaje: b.puntaje,
    puntaje_max: b.maximo,
  }))
  const { error: eB } = await svc.from('calidad_llamadas_bloques').insert(bloques)
  if (eB) throw new Error(`insert bloques: ${eB.message}`)

  const SEV: Record<string, string> = { C1: 'critica', C2: 'critica', C3: 'alta', C4: 'alta', C5: 'media', C6: 'media' }
  // Solo las presentes se guardan: una bandera con veredicto "ausente" es
  // parte del rastro de la auditoria, no un hallazgo de la llamada.
  const hallazgos = presentes.map((b) => ({
    workspace_id: workspaceId,
    llamada_id: llamadaId,
    eje: 'cumplimiento',
    codigo: b.codigo,
    severidad: SEV[b.codigo] ?? 'media',
    titulo: b.hecho.slice(0, 120),
    hecho: b.hecho,
    cita: null,
    segundo: (() => {
      const p = (b.momento ?? '0:00').split(':').map(Number)
      return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : (p[0] ?? 0) * 60 + (p[1] ?? 0)
    })(),
  }))
  if (hallazgos.length) {
    const { error: eH } = await svc.from('calidad_llamadas_hallazgos').insert(hallazgos)
    if (eH) throw new Error(`insert hallazgos: ${eH.message}`)
  }
  const tGuardar = Date.now() - t

  console.log(`\n4 guardar      ${seg(tGuardar)} · llamada ${llamadaId}`)
  console.log(`   detalle      /calidad/llamada/${llamadaId}`)
  console.log(`\ntotal          ${seg(tTranscribir + tRedactar + tAuditar + tGuardar)}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
