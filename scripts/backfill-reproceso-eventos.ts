/**
 * Repone en `reproceso_eventos` los reprocesos que se abrieron mientras el insert
 * estaba fallando.
 *
 * Por que existe: `reprocesarNegocio` escribia el hecho con el cliente de la sesion
 * y la tabla le revoca la escritura a `authenticated` a proposito, asi que cada
 * insert volvia con **42501 `permission denied`** y un `console.error` que nadie
 * mira. Medido el 2026-08-31 en SOENA: la tabla con **0 filas** y **7 reprocesos
 * reales** abiertos por la supervisora entre el 13 y el 27 de agosto. El defecto
 * quedo corregido en el codigo; esto recupera lo que ya se habia perdido.
 *
 * De donde sale el dato: `negocios.metadata.reproceso`, que es la marca que SI se
 * escribio. ⚠️ Esa marca solo conserva el ciclo **VIGENTE** — al abrir el ciclo 2
 * se pisa el 1 —, asi que lo que este script repone es un **piso, no el total**:
 * de un negocio que haya ido y vuelto dos veces solo se puede recuperar el ultimo
 * ciclo. Los ciclos intermedios se perdieron y no hay de donde sacarlos. El script
 * lo dice en la salida en vez de dejar creer que repuso todo.
 *
 * La atribucion NO se reimplementa aqui: usa `resolverAtribucionReproceso`, la
 * misma funcion que corre en la aplicacion. Una copia en el script le imputaria el
 * error a alguien distinto del que se lo imputa la app, sobre un dato del que
 * cuelga el 40% del bono.
 *
 * Idempotente: salta el evento si ya existe uno para (negocio, ciclo). Correrlo
 * dos veces no duplica nada.
 *
 * Uso:
 *   cd metrik-one
 *   npx tsx scripts/backfill-reproceso-eventos.ts soena             # dry-run
 *   npx tsx scripts/backfill-reproceso-eventos.ts soena --commit    # escribe
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  resolverAtribucionReproceso,
  type CausaReproceso,
  type TipoReproceso,
} from '../src/lib/negocios/atribucion-reproceso'

const COMMIT = process.argv.includes('--commit')
const SLUG = process.argv[2]
if (!SLUG || SLUG.startsWith('--')) {
  console.error('Uso: npx tsx scripts/backfill-reproceso-eventos.ts <workspace_slug> [--commit]')
  process.exit(1)
}

const env: Record<string, string> = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

type Marca = {
  activo?: boolean
  tipo?: TipoReproceso
  ciclo?: number
  causa?: CausaReproceso
  detalle?: string
  abierto_at?: string
  abierto_por?: string | null
  cerrado_at?: string | null
}

async function main() {
  const { data: ws, error: errWs } = await supabase
    .from('workspaces')
    .select('id')
    .eq('slug', SLUG)
    .maybeSingle()
  if (errWs) throw errWs
  if (!ws) throw new Error(`No existe el workspace "${SLUG}"`)
  const workspaceId = (ws as { id: string }).id

  const { data: negocios, error: errNeg } = await supabase
    .from('negocios')
    .select('id, codigo, nombre, metadata')
    .eq('workspace_id', workspaceId)
    .not('metadata->reproceso', 'is', null)
  if (errNeg) throw errNeg

  const filas = (negocios ?? []) as Array<{
    id: string
    codigo: string | null
    nombre: string | null
    metadata: { reproceso?: Marca } | null
  }>

  console.log(`\n${COMMIT ? 'ESCRIBIENDO' : 'DRY-RUN (nada se escribe)'} · workspace ${SLUG}`)
  console.log(`Negocios con marca de reproceso: ${filas.length}\n`)

  let repuestos = 0
  let yaEstaban = 0
  let sinAtribuir = 0
  const saltados: string[] = []

  for (const n of filas) {
    const m = n.metadata?.reproceso
    // Sin tipo, ciclo o fecha no se puede asentar un hecho: se reporta y se salta,
    // en vez de inventar un valor por defecto que despues nadie pueda distinguir.
    if (!m?.tipo || !m?.ciclo || !m?.abierto_at) {
      saltados.push(`${n.codigo ?? n.id} (marca incompleta)`)
      continue
    }

    const { data: yaExiste } = await supabase
      .from('reproceso_eventos')
      .select('id')
      .eq('negocio_id', n.id)
      .eq('ciclo', m.ciclo)
      .maybeSingle()
    if (yaExiste) {
      yaEstaban++
      continue
    }

    const atribuidoA = await resolverAtribucionReproceso(supabase, n.id, m.tipo)
    if (!atribuidoA) sinAtribuir++

    const fila = {
      workspace_id: workspaceId,
      negocio_id: n.id,
      ciclo: m.ciclo,
      tipo: m.tipo,
      causa: m.causa ?? 'criterio_tercero',
      detalle: m.detalle ?? '',
      atribuido_a: atribuidoA,
      abierto_por: m.abierto_por ?? null,
      abierto_at: m.abierto_at,
      cerrado_at: m.cerrado_at ?? null,
    }

    console.log(
      `  ${n.codigo ?? n.id}  ciclo ${m.ciclo}  ${m.tipo}  causa=${fila.causa}  ` +
        `atribuido=${atribuidoA ?? 'SIN ATRIBUIR'}  ${m.cerrado_at ? 'cerrado' : 'abierto'}`,
    )

    if (COMMIT) {
      const { error } = await supabase.from('reproceso_eventos').insert(fila)
      if (error) {
        console.error(`  ✗ ${n.codigo}: ${error.message}`)
        continue
      }
    }
    repuestos++
  }

  console.log(`\n${COMMIT ? 'Repuestos' : 'Se repondrian'}: ${repuestos}`)
  console.log(`Ya estaban: ${yaEstaban}`)
  console.log(`Sin atribuir (quedan en NULL, se cuentan aparte en el tablero): ${sinAtribuir}`)
  if (saltados.length) console.log(`Saltados: ${saltados.join(', ')}`)
  console.log(
    `\n⚠️ Piso, no total: la marca solo guarda el ciclo vigente, asi que de un negocio\n` +
      `   con varios ciclos solo se recupera el ultimo. Los intermedios se perdieron.`,
  )
  if (!COMMIT) console.log('\nPara escribir: agrega --commit\n')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
