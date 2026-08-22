/**
 * Sonda de resolucion participante -> cliente. NO escribe nada.
 *
 * Barre N dias de calendario y, por cada reunion con transcripcion, muestra a
 * que empresa y negocio de ONE cae y CUAL senal lo resolvio. Sirve para medir
 * la cascada de `lib/actas/cliente` contra el calendario real antes de que el
 * cron mande nada.
 *
 *   npx tsx scripts/actas-participantes.ts 30
 */
import './_load-env'
import { createClient } from '@supabase/supabase-js'
import { listarReunionesDelDia } from '@/lib/actas/calendario'
import { DOMINIO_METRIK } from '@/lib/actas/seleccion'
import { cargarDirectorio, resolverCliente } from '@/lib/actas/cliente'

const WS_METRIK = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
const dias = Number(process.argv[2] ?? 30)

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

async function main() {
  const directorio = await cargarDirectorio(sb, WS_METRIK)
  console.log(
    `\nDirectorio metrik: ${directorio.empresas.length} empresas, ` +
      `${directorio.empresas.flatMap((e) => e.correos).length} correos, ` +
      `${directorio.empresas.flatMap((e) => e.dominios).length} dominios\n`,
  )

  const conteo: Record<string, number> = {}
  const faltantes = new Set<string>()
  const hoy = new Date()

  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoy)
    d.setDate(d.getDate() - i)
    for (const r of await listarReunionesDelDia(d)) {
      if (!r.transcriptFileId) continue
      const externos = r.participantes
        .map((p) => p.email)
        .filter((e) => !e.toLowerCase().endsWith(`@${DOMINIO_METRIK}`))
      const res = resolverCliente(externos, r.titulo, directorio)

      const clave = res.senal ?? 'sin_resolver'
      conteo[clave] = (conteo[clave] ?? 0) + 1
      res.correosNuevos.forEach((c) => faltantes.add(c))

      const negocio = res.negocio
        ? `${res.negocio.codigo} · ${res.negocio.nombre}  [${res.senalNegocio}]`
        : res.negociosCandidatos.length
          ? `AMBIGUO entre ${res.negociosCandidatos.map((n) => n.codigo).join(', ')}`
          : '(sin negocio abierto)'
      console.log(`${d.toISOString().slice(0, 10)}  ${r.titulo}`)
      console.log(`   -> ${res.empresa?.nombre ?? 'SIN CLIENTE'}  [${clave}/${res.confianza}]`)
      console.log(`   -> ${negocio}`)
    }
  }

  console.log('\nResumen por senal:', conteo)
  console.log(`\nCorreos que faltan en el directorio (${faltantes.size}):`)
  ;[...faltantes].sort().forEach((c) => console.log(`  ${c}`))
}

main()
