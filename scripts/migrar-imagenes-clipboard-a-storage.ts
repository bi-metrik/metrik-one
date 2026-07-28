/**
 * Migra las imágenes pegadas (campos `imagen_clipboard`) que están guardadas como
 * data URL dentro de `negocio_bloques.data` a Supabase Storage, dejando en el jsonb
 * solo la URL pública.
 *
 *   npx tsx scripts/migrar-imagenes-clipboard-a-storage.ts            # dry run
 *   npx tsx scripts/migrar-imagenes-clipboard-a-storage.ts --commit   # escribe
 *
 * Por qué: un PNG en base64 dentro del jsonb obliga a Postgres a descomprimir el
 * documento entero en cada lectura del bloque, aunque solo se pida una clave. En
 * SOENA eso hacía que la lista de negocios moviera 22 MB por carga para pintar
 * cuatro campos de texto, y era el 32% del tiempo total de base de datos.
 *
 * Idempotente: solo toca valores que empiezan por `data:image/`. Correrlo dos veces
 * no hace nada la segunda vez. No borra ni reescribe ninguna otra clave del bloque.
 *
 * Deduplica por contenido dentro de un mismo negocio: los bloques heredados (copias
 * readonly del bloque origen) traen el mismo pantallazo, así que se sube una vez y
 * las copias apuntan al mismo archivo.
 *
 * Corre con service_role (bypasea RLS).
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 've-documentos'
const COMMIT = process.argv.includes('--commit')

const env: Record<string, string> = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

type Fila = {
  id: string
  negocio_id: string
  data: Record<string, unknown>
  negocios: { workspace_id: string } | null
}

const DATA_URL_RE = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i

function fmt(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} kB`
}

async function main() {
  console.log(COMMIT ? '── MODO ESCRITURA ──' : '── DRY RUN (usa --commit para escribir) ──')

  // PostgREST corta en 1.000 filas por defecto: hay que paginar o se migra solo
  // una parte de la tabla en silencio. Orden estable por id para no saltar filas.
  const PAGINA = 500
  const filas: Fila[] = []
  for (let desde = 0; ; desde += PAGINA) {
    const { data: pagina, error } = await supabase
      .from('negocio_bloques')
      .select('id, negocio_id, data, negocios(workspace_id)')
      .order('id', { ascending: true })
      .range(desde, desde + PAGINA - 1)
      .returns<Fila[]>()
    if (error) throw error
    if (!pagina || pagina.length === 0) break
    filas.push(...pagina)
    if (pagina.length < PAGINA) break
  }
  console.log(`Filas leídas: ${filas.length}\n`)

  // Cache por (negocio, contenido): los bloques heredados repiten el mismo pantallazo.
  const subidas = new Map<string, string>()
  let bloquesTocados = 0
  let clavesMigradas = 0
  let bytesLiberados = 0
  let fallos = 0

  for (const fila of filas) {
    const data = fila.data ?? {}
    const workspaceId = fila.negocios?.workspace_id
    if (!workspaceId) continue

    const nuevas: Record<string, string> = {}

    for (const [clave, valor] of Object.entries(data)) {
      if (typeof valor !== 'string') continue
      const m = DATA_URL_RE.exec(valor)
      if (!m) continue

      const mimeType = m[1].toLowerCase()
      const buffer = Buffer.from(m[2], 'base64')
      const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
      const cacheKey = `${fila.negocio_id}:${hash}`

      let url = subidas.get(cacheKey)
      if (!url) {
        const ext = mimeType.split('/')[1]?.replace(/\+.*$/, '') ?? 'png'
        const storagePath = `${workspaceId}/negocios/${fila.negocio_id}/clipboard/${hash}.${ext}`

        if (COMMIT) {
          const { error: upErr } = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, buffer, { contentType: mimeType, upsert: true })
          if (upErr) {
            console.error(`  ✗ ${fila.id} · ${clave}: ${upErr.message}`)
            fallos++
            continue
          }
        }
        url = supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl
        subidas.set(cacheKey, url)
      }

      nuevas[clave] = url
      clavesMigradas++
      bytesLiberados += valor.length
      console.log(`  ${fila.id} · ${clave} · ${fmt(valor.length)} → ${hash}`)
    }

    if (Object.keys(nuevas).length === 0) continue
    bloquesTocados++

    if (COMMIT) {
      // Merge sobre el data actual: no se toca ninguna otra clave del bloque.
      const { error: updErr } = await supabase
        .from('negocio_bloques')
        .update({ data: { ...data, ...nuevas } })
        .eq('id', fila.id)
      if (updErr) {
        console.error(`  ✗ update ${fila.id}: ${updErr.message}`)
        fallos++
      }
    }
  }

  console.log('\n── Resumen ──')
  console.log(`Bloques tocados:    ${bloquesTocados}`)
  console.log(`Claves migradas:    ${clavesMigradas}`)
  console.log(`Archivos subidos:   ${subidas.size} (deduplicados por contenido)`)
  console.log(`Peso sacado del jsonb: ${fmt(bytesLiberados)}`)
  if (fallos > 0) console.log(`⚠ Fallos: ${fallos}`)
  if (!COMMIT) console.log('\nNada se escribió. Re-correr con --commit.')
  else console.log('\nDespués de esto: VACUUM (FULL) negocio_bloques; para devolver el espacio al disco.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
