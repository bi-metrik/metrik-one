/**
 * Sonda de agenda. NO escribe nada.
 *
 * Lista TODOS los eventos del rango, tengan transcripcion o no, con el motivo
 * cuando no la tienen. La sonda de participantes solo mira los que ya traen
 * transcripcion, asi que una reunion que si ocurrio pero cuyo evento no quedo
 * con el adjunto es invisible ahi. Aqui si se ve.
 *
 *   npx tsx scripts/actas-agenda.ts 2026-08-17 2026-08-23
 */
import './_load-env'
import { listarReunionesDelDia } from '@/lib/actas/calendario'

const [desde, hasta] = process.argv.slice(2)
if (!desde) {
  console.error('Uso: npx tsx scripts/actas-agenda.ts YYYY-MM-DD [YYYY-MM-DD]')
  process.exit(1)
}

async function main() {
  const fin = new Date(`${hasta ?? desde}T12:00:00-05:00`)
  for (let d = new Date(`${desde}T12:00:00-05:00`); d <= fin; d.setDate(d.getDate() + 1)) {
    const reuniones = await listarReunionesDelDia(new Date(d))
    for (const r of reuniones) {
      const min = Math.round(r.duracionAgendadaSegundos / 60)
      const estado = r.transcriptFileId
        ? `transcripcion: ${r.transcriptNombre}`
        : `SIN TRANSCRIPCION (${r.motivoSinTranscripcion})`
      console.log(`${r.inicio.slice(0, 16)}  ${min}min agendados  ${r.titulo}`)
      console.log(`   ${estado}`)
      console.log(`   ${r.participantes.map((p) => p.email).join(', ')}`)
    }
  }
}

main()
