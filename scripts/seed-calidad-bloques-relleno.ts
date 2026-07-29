/**
 * Desglose por bloque para las llamadas de relleno del workspace `regat`.
 *
 * POR QUE EXISTE
 *
 * El perfil de agente recomienda donde entrenar a partir de los bloques en los
 * que ese agente esta mas lejos del maximo. Hasta ahora el desglose solo lo
 * tenian las DOS llamadas auditadas a mano, asi que la recomendacion habria
 * existido unicamente para Felipe — y armada sobre una sola llamada. Con eso la
 * pantalla no cumple lo que promete y se cae en cuanto alguien abre el perfil
 * de otro agente.
 *
 * Este script NO inventa un puntaje nuevo: descompone el que ya existe. El
 * `puntaje_tecnico` de cada llamada es el dato; los siete bloques son ese mismo
 * numero repartido. La invariante que lo mantiene honesto es que la suma de los
 * bloques es EXACTAMENTE el puntaje de la llamada, igual que en las dos
 * auditadas a mano (73 y 36).
 *
 * ADITIVO E IDEMPOTENTE. Solo inserta para llamadas que no tienen bloques, asi
 * que las dos auditadas conservan su desglose escrito a mano y volver a correrlo
 * no duplica nada ni mueve los numeros que ya se revisaron en pantalla.
 *
 * DETERMINISTA. PRNG sembrado por `cliente_ref`, no por indice de iteracion:
 * dos corridas producen el mismo reparto para la misma llamada aunque el orden
 * en que llegan cambie.
 *
 * Uso:
 *   npx tsx scripts/seed-calidad-bloques-relleno.ts
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!URL || !KEY) {
  console.error('Faltan env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const svc = createClient(URL, KEY, { auth: { persistSession: false } })

const SLUG = 'regat'

/** Los siete bloques de la rubrica, con su maximo. Suman 100. */
const BLOQUES = [
  { orden: 1, nombre: 'Apertura e identificación', max: 10 },
  { orden: 2, nombre: 'Descubrimiento', max: 25 },
  { orden: 3, nombre: 'Escucha y control', max: 15 },
  { orden: 4, nombre: 'Educación técnica', max: 20 },
  { orden: 5, nombre: 'Propuesta y precio', max: 10 },
  { orden: 6, nombre: 'Manejo de objeciones', max: 10 },
  { orden: 7, nombre: 'Cierre y próximos pasos', max: 10 },
] as const

const TOTAL_MAX = BLOQUES.reduce((a, b) => a + b.max, 0) // 100

/**
 * Como se reparte el puntaje dentro de cada agente: la fraccion del maximo que
 * suele lograr en cada bloque.
 *
 * NO es decoracion. Es lo que hace que la recomendacion sea distinta para cada
 * persona, que es el punto de la pantalla: si todos tuvieran el mismo reparto,
 * el consejo seria el mismo para todos y no habria nada que entrenar.
 *
 * El de Felipe sale de su llamada auditada a mano (10/10, 24/25, 4/15, 19/20,
 * 4/10, 4/10, 8/10): sabe abrir, indagar y explicar; no sabe escuchar ni
 * defender precio. El resto se diseñan para que cada uno tenga SU palanca —
 * Tatiana escucha bien, a Karina se le cae el cierre, Hector abre flojo pero
 * escucha. Sergio no da distribuciones ("depende de la base"), asi que esto se
 * diseña, no se estima.
 */
const PERFIL_BLOQUES: Record<string, number[]> = {
  //                    Apert  Descu  Escu  Educ  Prec  Obje  Cierre
  'Felipe Sandoval':   [1.00,  0.96,  0.27, 0.95, 0.40, 0.40, 0.80],
  'Tatiana Bermúdez':  [0.95,  0.90,  0.88, 0.86, 0.82, 0.80, 0.84],
  'Karina Villalba':   [0.90,  0.84,  0.72, 0.80, 0.70, 0.66, 0.48],
  'Diego Rincón':      [0.72,  0.80,  0.30, 0.62, 0.46, 0.34, 0.66],
  'Óscar Peñaloza':    [0.86,  0.58,  0.66, 0.78, 0.62, 0.60, 0.72],
  'Héctor Salgado':    [0.52,  0.74,  0.80, 0.54, 0.66, 0.70, 0.62],
  'Liliana Prieto':    [0.84,  0.78,  0.62, 0.76, 0.58, 0.36, 0.70],
}
/** Agente sin perfil declarado: reparto parejo, sin palanca inventada. */
const PERFIL_NEUTRO = [0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7]

// ── PRNG determinista, sembrado por texto ───────────────────────────────────
function semillaDeTexto(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
function prng(seed: number) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Reparte `total` entre los siete bloques respetando el techo de cada uno.
 *
 * Escalar los pesos y ya no sirve: un bloque puede pasarse de su maximo (un
 * puntaje de 92 con el perfil de Felipe empujaria Apertura por encima de 10) y
 * quedaria un desglose imposible. Por eso se llena por rondas: se reparte, se
 * corta lo que se pasa del techo, y el sobrante se vuelve a repartir entre los
 * que aun tienen espacio. Al final se cuadra el redondeo para que la suma sea
 * EXACTAMENTE el puntaje de la llamada.
 */
function repartir(total: number, pesos: number[], r: () => number): number[] {
  const maxs = BLOQUES.map((b) => b.max)
  // Jitter por bloque para que dos llamadas del mismo agente no salgan calcadas.
  const w = pesos.map((p) => Math.max(0.05, p * (0.85 + r() * 0.3)))

  const val = new Array(BLOQUES.length).fill(0)
  const lleno = new Array(BLOQUES.length).fill(false)
  let restante = Math.max(0, Math.min(total, TOTAL_MAX))

  for (let ronda = 0; ronda < 12 && restante > 0.0001; ronda++) {
    const base = BLOQUES.map((b, i) => (lleno[i] ? 0 : w[i] * b.max))
    const suma = base.reduce((a, b) => a + b, 0)
    if (suma <= 0) break
    let repartido = 0
    for (let i = 0; i < BLOQUES.length; i++) {
      if (lleno[i]) continue
      const cuota = (base[i] / suma) * restante
      const espacio = maxs[i] - val[i]
      const da = Math.min(cuota, espacio)
      val[i] += da
      repartido += da
      if (maxs[i] - val[i] < 0.0001) lleno[i] = true
    }
    restante -= repartido
    if (repartido < 0.0001) break
  }

  // Redondeo con cuadre: el residuo cae donde haya espacio, empezando por el
  // bloque de mayor techo (es donde menos se nota y donde siempre cabe).
  const ent = val.map((v) => Math.round(v))
  let dif = Math.round(Math.min(total, TOTAL_MAX)) - ent.reduce((a, b) => a + b, 0)
  const orden = BLOQUES.map((b, i) => i).sort((a, b) => maxs[b] - maxs[a])
  while (dif !== 0) {
    let movido = false
    for (const i of orden) {
      if (dif > 0 && ent[i] < maxs[i]) {
        ent[i] += 1
        dif -= 1
        movido = true
      } else if (dif < 0 && ent[i] > 0) {
        ent[i] -= 1
        dif += 1
        movido = true
      }
      if (dif === 0) break
    }
    if (!movido) break
  }
  return ent
}

async function main() {
  const { data: ws, error: eWs } = await svc
    .from('workspaces')
    .select('id')
    .eq('slug', SLUG)
    .single()
  if (eWs || !ws) throw new Error(`No existe el workspace ${SLUG}`)
  const workspaceId = ws.id as string

  // Llamadas que YA tienen desglose: no se tocan.
  const yaTienen = new Set<string>()
  for (let desde = 0; ; desde += 1000) {
    const { data } = await svc
      .from('calidad_llamadas_bloques')
      .select('llamada_id')
      .eq('workspace_id', workspaceId)
      .range(desde, desde + 999)
    if (!data || data.length === 0) break
    for (const b of data as { llamada_id: string }[]) yaTienen.add(b.llamada_id)
    if (data.length < 1000) break
  }

  // Todas las llamadas del workspace, paginadas (son ~2.800).
  const llamadas: { id: string; cliente_ref: string; agente_nombre: string; puntaje_tecnico: number }[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await svc
      .from('calidad_llamadas')
      .select('id, cliente_ref, agente_nombre, puntaje_tecnico')
      .eq('workspace_id', workspaceId)
      .order('cliente_ref')
      .range(desde, desde + 999)
    if (error) throw new Error(`llamadas: ${error.message}`)
    if (!data || data.length === 0) break
    llamadas.push(...(data as typeof llamadas))
    if (data.length < 1000) break
  }

  console.log(`llamadas       ${llamadas.length}  ·  con desglose previo: ${yaTienen.size}`)

  const filas: Record<string, unknown>[] = []
  let conflictos = 0

  for (const l of llamadas) {
    if (yaTienen.has(l.id)) continue
    const r = prng(semillaDeTexto(l.cliente_ref))
    const pesos = PERFIL_BLOQUES[l.agente_nombre] ?? PERFIL_NEUTRO
    const val = repartir(l.puntaje_tecnico, pesos, r)

    const suma = val.reduce((a, b) => a + b, 0)
    if (suma !== l.puntaje_tecnico) {
      conflictos += 1
      continue
    }
    BLOQUES.forEach((b, i) => {
      filas.push({
        workspace_id: workspaceId,
        llamada_id: l.id,
        orden: b.orden,
        nombre: b.nombre,
        puntaje: val[i],
        puntaje_max: b.max,
      })
    })
  }

  if (conflictos > 0) {
    throw new Error(
      `${conflictos} llamadas quedaron con suma(bloques) != puntaje_tecnico. El desglose ` +
        `tiene que reproducir el puntaje exacto: si no, la pantalla de perfil muestra un ` +
        `total que no coincide con el de la llamada.`,
    )
  }

  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await svc.from('calidad_llamadas_bloques').insert(filas.slice(i, i + 500))
    if (error) throw new Error(`bloques: ${error.message}`)
  }
  console.log(`insertado      ${filas.length} filas (${filas.length / 7} llamadas)`)

  // ── Verificacion contra la base, no contra lo que creemos haber escrito ──
  //
  // Se comprueba sobre una muestra por agente: que cada llamada tenga sus siete
  // bloques y que la suma sea el puntaje de la llamada. Si el desglose no
  // reprodujera el total, la pantalla de perfil mostraria un numero que no
  // coincide con el de la llamada — y ese es justo el tipo de incoherencia que
  // se ve en vivo.
  const agentes = [...new Set(llamadas.map((l) => l.agente_nombre))]
  for (const agente of agentes) {
    const muestra = llamadas.filter((l) => l.agente_nombre === agente).slice(0, 3)
    for (const l of muestra) {
      const { data: bs } = await svc
        .from('calidad_llamadas_bloques')
        .select('puntaje')
        .eq('llamada_id', l.id)
      const n = bs?.length ?? 0
      const suma = ((bs ?? []) as { puntaje: number }[]).reduce((a, b) => a + b.puntaje, 0)
      if (n !== 7 || suma !== l.puntaje_tecnico) {
        throw new Error(
          `${l.cliente_ref} (${agente}): ${n} bloques, suma ${suma}, puntaje ${l.puntaje_tecnico}`,
        )
      }
    }
    console.log(`verificado     ${agente.padEnd(18)} muestra de ${muestra.length} · 7 bloques · suma = puntaje`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
