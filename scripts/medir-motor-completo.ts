/**
 * Mide la dispersion del motor COMPLETO: dos pasadas + ensamblaje.
 *
 * Es el gate acordado antes de construir la pantalla: si la dispersion no baja
 * de 9 puntos, hay que avisar en vez de seguir.
 *
 * Corre sobre la transcripcion completa ya redactada, no sobre audio, para que
 * la unica fuente de variacion sea el juicio del modelo.
 *
 * Uso:
 *   npx tsx scripts/medir-motor-completo.ts [corridas]
 */

import { config } from 'dotenv'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { auditarTranscripcion } from '../src/lib/calidad/motor-auditoria'

config({ path: resolve(process.cwd(), '.env.local') })

const API_KEY = process.env.GEMINI_API_KEY!

const RUTA_PROMPT =
  '/Users/mauricio/Developer/metrik/proyectos/regat/clarity/docs/entrega/prompt-motor-auditoria.md'
const RUTA_TRANSCRIPCION =
  '/Users/mauricio/Developer/metrik/proyectos/regat/clarity/docs/entrada/Clarity : Regat SAS/transcripcion-llamada-20260521_REDACTADA.txt'

const REFERENCIA = 73
const BLOQUES_REF = [10, 24, 4, 19, 4, 4, 8]

/** Los dos prompts salen del mismo documento, que es la fuente documentada. */
function cargarPrompts() {
  const md = readFileSync(RUTA_PROMPT, 'utf-8')
  const bloques = [...md.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1])
  const cumplimiento = bloques.find((b) => b.includes('ÚNICA tarea') || b.includes('UNICA tarea'))
  const tecnica = bloques.find((b) => b.includes('Eje técnica') && b.includes('7 bloques'))
  if (!cumplimiento) throw new Error('No se encontro el prompt de la pasada A')
  if (!tecnica) throw new Error('No se encontro el prompt de la pasada B')
  return { cumplimiento, tecnica }
}

const seg = (ms: number) => `${(ms / 1000).toFixed(1)} s`

async function main() {
  const n = Number(process.argv[2] ?? 3)
  const prompts = cargarPrompts()
  const transcripcion = readFileSync(RUTA_TRANSCRIPCION, 'utf-8')

  console.log(`entrada        transcripcion completa redactada · ${transcripcion.length} caracteres`)
  console.log(`referencia     ${REFERENCIA}/100 · bloques ${BLOQUES_REF.join(' · ')}`)
  console.log(`corridas       ${n}\n`)

  const puntajes: number[] = []
  const porBloque: number[][] = []
  const criticas: number[] = []
  let c2Detectada = 0

  for (let i = 1; i <= n; i++) {
    const r = await auditarTranscripcion(transcripcion, prompts, API_KEY)
    const suma = r.tecnica.bloques.reduce((a, b) => a + b.puntaje, 0)
    puntajes.push(r.tecnica.puntaje)
    porBloque.push(r.tecnica.bloques.map((b) => b.puntaje))
    criticas.push(r.cumplimiento.errores_criticos)
    if (r.cumplimiento.banderas.some((b) => b.codigo === 'C2' && b.presente)) c2Detectada += 1

    const c2 = r.cumplimiento.banderas.find((b) => b.codigo === 'C2')
    console.log(
      `corrida ${i}      ${String(r.tecnica.puntaje).padStart(3)}/100 ${suma === r.tecnica.puntaje ? '✓' : '✗'} · ` +
        `${r.cumplimiento.semaforo.toUpperCase()} ${r.cumplimiento.errores_criticos} críticas · ` +
        `C2 ${c2?.presente ? `en ${c2.momento}` : 'NO'} · ` +
        `A ${seg(r.tiempos.cumplimientoMs)} B ${seg(r.tiempos.tecnicaMs)} total ${seg(r.tiempos.totalMs)}`,
    )
    console.log(`               bloques ${r.tecnica.bloques.map((b) => b.puntaje).join(' · ')}`)
  }

  const min = Math.min(...puntajes)
  const max = Math.max(...puntajes)
  const media = puntajes.reduce((a, b) => a + b, 0) / puntajes.length

  console.log(`\ndispersion     ${max - min} puntos  (${min} – ${max})`)
  console.log(`media          ${media.toFixed(1)}  ·  referencia ${REFERENCIA}  ·  desvio ${(media - REFERENCIA).toFixed(1)}`)
  console.log(`C2 detectada   ${c2Detectada} de ${n}`)
  console.log(`criticas       ${criticas.join(' · ')}`)

  const nombres = ['Apertura', 'Descubrimiento', 'Escucha', 'Educación', 'Propuesta', 'Objeciones', 'Cierre']
  console.log('\npor bloque:')
  for (let b = 0; b < nombres.length; b++) {
    const vals = porBloque.map((c) => c[b] ?? 0)
    const rango = Math.max(...vals) - Math.min(...vals)
    console.log(
      `  ${nombres[b].padEnd(15)} ref ${String(BLOQUES_REF[b]).padStart(2)} · ${vals.join(' ')} · rango ${rango}`,
    )
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
