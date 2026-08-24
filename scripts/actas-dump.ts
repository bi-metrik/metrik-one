/**
 * Vuelca a stdout la transcripcion ya parseada de una reunion del dia.
 * Solo lectura. Sirve para mirar el insumo real del acta sin adivinar.
 *
 *   npx tsx scripts/actas-dump.ts 2026-08-20 "Sesión Final"
 */
import './_load-env'
import { parseIntervenciones, recortarPreludio } from '@/lib/actas/alcance'
import { seleccionarDelDia } from '@/lib/actas/seleccion'

const [fecha, filtro] = process.argv.slice(2)
if (!fecha) {
  console.error('Uso: npx tsx scripts/actas-dump.ts YYYY-MM-DD [filtro-titulo]')
  process.exit(1)
}

async function main() {
  const r = await seleccionarDelDia(new Date(`${fecha}T12:00:00-05:00`))
  const elegidas = r.candidatas.filter(
    (c) => !filtro || (c.reunion.titulo ?? '').toLowerCase().includes(filtro.toLowerCase()),
  )
  for (const c of elegidas) {
    console.log(`===== ${c.reunion.titulo} =====`)
    console.log(`inicio: ${c.reunion.inicio}   duracion real: ${Math.round(c.duracionRealSegundos / 60)} min`)
    console.log(`participantes: ${c.reunion.participantes.map((p) => p.email).join(', ')}`)
    console.log(`asistentes (transcripcion): ${c.transcripcion.asistentes.join(', ')}`)
    const { intervenciones, recortadas } = recortarPreludio(
      parseIntervenciones(c.transcripcion.cuerpo),
    )
    console.log(`preludio recortado: ${recortadas} intervenciones`)
    console.log('----- cuerpo -----')
    console.log(intervenciones.map((i) => `${i.hablante}: ${i.texto}`).join('\n'))
  }
}

main()
