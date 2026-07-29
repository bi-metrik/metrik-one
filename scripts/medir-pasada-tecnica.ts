/**
 * Mide la dispersion del puntaje tecnico con la PASADA B aislada.
 *
 * La pregunta: al quitarle al modelo la carga de rastrear las seis banderas,
 * ¿se estrecha la dispersion del total tecnico? La medicion del team lead sobre
 * la llamada completa con una sola pasada dio 65 / 80 / 70 — quince puntos de
 * rango sobre una referencia de 73.
 *
 * Se corre sobre la transcripcion COMPLETA ya redactada a mano, no sobre audio:
 * asi la unica fuente de variacion que queda es el juicio del modelo, sin el
 * ruido de que cada transcripcion salga distinta.
 *
 * Uso:
 *   npx tsx scripts/medir-pasada-tecnica.ts [corridas]
 */

import { config } from 'dotenv'
import { readFileSync } from 'fs'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const MODELO = 'gemini-3.6-flash'
const API_KEY = process.env.GEMINI_API_KEY!

const RUTA_PROMPT =
  '/Users/mauricio/Developer/metrik/proyectos/regat/clarity/docs/entrega/prompt-motor-auditoria.md'
const RUTA_TRANSCRIPCION =
  '/Users/mauricio/Developer/metrik/proyectos/regat/clarity/docs/entrada/Clarity : Regat SAS/transcripcion-llamada-20260521_REDACTADA.txt'

/** Referencia de la auditoria hecha a mano. */
const REFERENCIA = 73
const BLOQUES_REF = [10, 24, 4, 19, 4, 4, 8]

/**
 * Extrae el prompt de sistema (pasada B). Es el TERCER bloque cercado del
 * documento: el primero es la pasada A y el segundo su ejemplo de salida.
 */
function promptTecnica(): string {
  const md = readFileSync(RUTA_PROMPT, 'utf-8')
  const bloques = [...md.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1])
  const sistema = bloques.find((b) => b.includes('Eje técnica') && b.includes('7 bloques'))
  if (!sistema) throw new Error('No se encontro el prompt de sistema en el documento')
  return sistema
}

async function unaCorrida(prompt: string, transcripcion: string) {
  const t = Date.now()
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text:
                  `${prompt}\n\n---\n\n` +
                  // La pasada B ignora las banderas: se lo decimos explicito para
                  // que no gaste atencion en algo que ya resolvio la pasada A.
                  `IMPORTANTE PARA ESTA CORRIDA: NO evalues el eje de cumplimiento. ` +
                  `Omite por completo la busqueda de banderas y el objeto "cumplimiento" ` +
                  `de la salida. Tu unica tarea es el eje TECNICA: los 7 bloques con sus items.\n\n` +
                  `Transcripcion:\n\n${transcripcion}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 32768,
          responseMimeType: 'application/json',
        },
      }),
    },
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const texto = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  const dato = JSON.parse(texto) as {
    tecnica: { puntaje: number; bloques: { puntaje: number; maximo: number }[] }
  }
  return {
    ms: Date.now() - t,
    puntaje: dato.tecnica.puntaje,
    bloques: dato.tecnica.bloques.map((b) => b.puntaje),
    suma: dato.tecnica.bloques.reduce((a, b) => a + b.puntaje, 0),
  }
}

async function main() {
  const n = Number(process.argv[2] ?? 3)
  const prompt = promptTecnica()
  const transcripcion = readFileSync(RUTA_TRANSCRIPCION, 'utf-8')

  console.log(`modelo         ${MODELO} · temperatura 0`)
  console.log(`entrada        transcripcion completa redactada (${transcripcion.length} caracteres)`)
  console.log(`referencia     ${REFERENCIA}/100 · bloques ${BLOQUES_REF.join(' · ')}`)
  console.log(`corridas       ${n}\n`)

  const puntajes: number[] = []
  for (let i = 1; i <= n; i++) {
    const r = await unaCorrida(prompt, transcripcion)
    puntajes.push(r.puntaje)
    const cuadra = r.suma === r.puntaje ? '✓' : `✗ suma ${r.suma}`
    console.log(
      `corrida ${i}      ${String(r.puntaje).padStart(3)}/100  ${cuadra}  ` +
        `${(r.ms / 1000).toFixed(1)} s  ·  ${r.bloques.join(' · ')}`,
    )
  }

  const min = Math.min(...puntajes)
  const max = Math.max(...puntajes)
  const media = puntajes.reduce((a, b) => a + b, 0) / puntajes.length
  console.log(`\nrango          ${min} – ${max}  (dispersion ${max - min} puntos)`)
  console.log(`media          ${media.toFixed(1)}  ·  referencia ${REFERENCIA}  ·  desvio ${(media - REFERENCIA).toFixed(1)}`)
  console.log(`comparacion    una sola pasada dio 65 / 80 / 70 → dispersion 15`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
