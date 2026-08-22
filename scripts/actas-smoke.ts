/**
 * Prueba de humo de la cadena de actas contra el calendario REAL.
 * No envia nada: solo imprime que reuniones pasarian el filtro y por que se
 * descartan las demas.
 *
 *   npx tsx scripts/actas-smoke.ts 2026-08-20
 */
import './_load-env'
import { seleccionarDelDia } from '@/lib/actas/seleccion'

const arg = process.argv[2]
if (!arg) {
  console.error('Uso: npx tsx scripts/actas-smoke.ts YYYY-MM-DD')
  process.exit(1)
}

const minimo = process.env.ACTAS_MINIMO_SEGUNDOS
  ? Number(process.env.ACTAS_MINIMO_SEGUNDOS)
  : undefined

async function main() {
  const r = await seleccionarDelDia(new Date(`${arg}T12:00:00-05:00`), {
    duracionMinimaSegundos: minimo,
  })

  console.log(`\nReuniones revisadas: ${r.revisadas}`)
  console.log(`Candidatas a acta:   ${r.candidatas.length}`)
  console.log(`Descartadas:         ${r.descartadas.length}\n`)

  for (const c of r.candidatas) {
    const min = Math.round(c.duracionRealSegundos / 60)
    console.log(`  [ACTA ${c.tipo}] ${c.reunion.titulo}`)
    console.log(`     duracion real: ${min} min (agendada ${Math.round(c.reunion.duracionAgendadaSegundos / 60)} min)`)
    console.log(`     participantes: ${c.reunion.participantes.map((p) => p.email).join(', ')}`)
    console.log(`     dominios externos: ${c.dominiosExternos.join(', ') || '(ninguno)'}`)
  }

  for (const d of r.descartadas) {
    console.log(`  [descartada] ${d.titulo} -> ${d.motivo}${d.detalle ? ` (${d.detalle})` : ''}`)
  }
}

main()
