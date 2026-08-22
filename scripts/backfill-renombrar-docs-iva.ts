/**
 * Backfill: renombra en Drive los documentos de la devolución de IVA que quedaron
 * con la numeración vieja.
 *
 * Contexto (decisión de Mauricio, 2026-08-22): la numeración final de los 8
 * documentos dejó dos labels cambiados —`008_FORMATO_1668` → `008_FORMULARIO_1668_DIAN`
 * y `008_CARTA_AUTORIZACION` → `009_CARTA_AUTORIZACION`—. La configuración ya está
 * aplicada, así que los documentos NUEVOS salen bien; este script arregla los que ya
 * están en Drive.
 *
 * ⚠️ ALCANCE DELIBERADO: solo los casos que **todavía no pasaron** la etapa del bloque.
 *    Un documento de un caso ya radicado ante la DIAN se quedó con el nombre con el que
 *    se radicó, y renombrarlo desalinearía el archivo con el expediente del tercero.
 *
 * ⚠️ NO toca la base de datos. Renombrar en Drive no cambia el id del archivo, así que
 *    `drive_url` y `drive_file_id` siguen sirviendo. Solo cambia el nombre visible.
 *
 * Credenciales: el workspace SOENA corre en modo `service_account`, cuya llave vive solo
 * en producción. Este script usa la OTRA vía que el mismo workspace ya tiene declarada
 * (`drive_client_id` + `drive_client_secret` + `drive_refresh_token` en
 * `workspaces.config_extra`), leyéndola de Supabase. Así corre desde cualquier lado con
 * solo la service role key, sin copiar secretos a mano.
 *
 * Uso:
 *   npx tsx scripts/backfill-renombrar-docs-iva.ts           → dry run (no escribe nada)
 *   npx tsx scripts/backfill-renombrar-docs-iva.ts --aplicar → renombra de verdad
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const LINEA = '34a0fa6b-9ed3-4652-a419-42601132d1a8'
const SLUGS = ['formulario_1668', 'formulario_1668_envio', 'carta_autorizacion_notariada']

const APLICAR = process.argv.includes('--aplicar')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/** Extrae el id de archivo de una URL de Drive. Null si la URL no tiene esa forma. */
function idDeUrl(url: string | null | undefined): string | null {
  const m = (url ?? '').match(/\/file\/d\/([^/]+)/)
  return m ? m[1] : null
}

/**
 * Token de Drive por la MISMA via que usa la app.
 *
 * No se reimplementa aqui: `getAccessToken` ya resuelve los tres modos (service account
 * con domain-wide delegation, OAuth per-workspace, OAuth global) leyendo el modo que el
 * workspace declara. Duplicarlo dejaria dos criterios de credencial que se separan solos.
 *
 * ⚠️ SOENA corre en `service_account`, asi que exige `GOOGLE_DRIVE_SA_KEY` (o
 *    `METRIK_PDF_RENDER_SA_KEY`) en el entorno. El OAuth guardado en `config_extra` NO
 *    sirve de respaldo: su refresh token ya responde `invalid_grant` (verificado el
 *    2026-08-22), que es justo por lo que el workspace migro a service account.
 */
async function tokenDrive(): Promise<string> {
  const { getAccessToken } = await import('../src/lib/google-drive')
  return getAccessToken(WS)
}

async function main() {
  const { data, error } = await supabase
    .from('negocio_bloques')
    .select(`
      id, data,
      negocios!inner(codigo, etapa_actual_id),
      bloque_configs!inner(slug, config_extra, etapas_negocio!inner(numero, nombre, linea_id))
    `)
    .in('bloque_configs.slug', SLUGS)
  if (error) throw new Error(error.message)

  // El `numero` de la etapa actual de cada negocio es lo que decide si el caso ya paso.
  // Se resuelve aparte porque el embed llega hasta la etapa del BLOQUE, no la del negocio.
  const { data: etapas } = await supabase
    .from('etapas_negocio')
    .select('id, numero')
    .eq('linea_id', LINEA)
  const numeroDeEtapa = new Map((etapas ?? []).map((e) => [e.id as string, e.numero as number]))

  type Fila = { codigo: string; etapa: string; fileId: string; nombreNuevo: string }
  const objetivo: Fila[] = []
  let yaPasaron = 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const cfg = row.bloque_configs
    if (cfg?.etapas_negocio?.linea_id !== LINEA) continue
    const fileId = idDeUrl(row.data?.drive_url)
    if (!fileId) continue
    const etapaBloque = cfg.etapas_negocio.numero as number
    const etapaCaso = numeroDeEtapa.get(row.negocios?.etapa_actual_id) ?? 0
    if (etapaCaso > etapaBloque) { yaPasaron++; continue }
    objetivo.push({
      codigo: row.negocios?.codigo ?? '?',
      etapa: cfg.etapas_negocio.nombre,
      fileId,
      nombreNuevo: cfg.config_extra?.label as string,
    })
  }

  objetivo.sort((a, b) => a.codigo.localeCompare(b.codigo))

  console.log(`Casos que ya pasaron la etapa (se dejan como estan): ${yaPasaron}`)
  console.log(`Archivos en alcance: ${objetivo.length}\n`)
  if (objetivo.length === 0) return

  const token = await tokenDrive()
  let porRenombrar = 0, yaCorrectos = 0, fallos = 0

  for (const o of objetivo) {
    const url = `https://www.googleapis.com/drive/v3/files/${o.fileId}?supportsAllDrives=true&fields=id,name`
    const get = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!get.ok) {
      console.log(`  x ${o.codigo} · ${o.etapa} — no se pudo leer el archivo (${get.status})`)
      fallos++
      continue
    }
    const actual = (await get.json()) as { name: string }
    // La extension se conserva: el label nombra el documento, no el archivo entero.
    const ext = actual.name.includes('.') ? actual.name.slice(actual.name.lastIndexOf('.')) : ''
    const destino = `${o.nombreNuevo}${ext}`

    if (actual.name === destino) {
      console.log(`  = ${o.codigo} · ${o.etapa} — ya se llama ${destino}`)
      yaCorrectos++
      continue
    }

    if (!APLICAR) {
      console.log(`  > ${o.codigo} · ${o.etapa} — "${actual.name}" => "${destino}"`)
      porRenombrar++
      continue
    }

    const patch = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: destino }),
    })
    if (!patch.ok) {
      console.log(`  x ${o.codigo} · ${o.etapa} — fallo el renombre (${patch.status}) ${await patch.text()}`)
      fallos++
      continue
    }
    console.log(`  ok ${o.codigo} · ${o.etapa} — "${actual.name}" => "${destino}"`)
    porRenombrar++
  }

  console.log(
    `\n${APLICAR ? 'Renombrados' : 'Se renombrarian'}: ${porRenombrar}` +
    ` · ya correctos: ${yaCorrectos} · fallos: ${fallos}` +
    (APLICAR ? '' : ' · DRY RUN, no se escribio nada'),
  )
}

main().catch((e) => { console.error(e.message); process.exit(1) })
