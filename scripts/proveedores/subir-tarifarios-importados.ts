/**
 * Sube al bucket los archivos de los tarifarios importados (de Airtable u otra fuente que deje
 * `origen = 'importacion'` y `origen_ref = '<rec>:<nombre original>'`) y llena `ref`, `bytes` y
 * `mime` de esas filas. No crea filas, no toca vigencias ni filas con `ref` ya lleno.
 *
 *   # Modo prueba (por defecto): solo lee, empareja, convierte en una carpeta temporal y dice qué haría.
 *   npx tsx scripts/proveedores/subir-tarifarios-importados.ts --workspace <uuid> --carpeta <ruta>
 *
 *   # Escribe (sube y actualiza las filas):
 *   npx tsx scripts/proveedores/subir-tarifarios-importados.ts --workspace <uuid> --carpeta <ruta> --aplicar
 *
 * - La carpeta tiene los archivos como `<rec>_<tarN|docN>_<nombre>`. Solo se suben los `tarN`; los
 *   `docN` (documentos/certificaciones, pueden ser bancarios) se cuentan y se dejan.
 * - doc/docx/ppt/pptx/xls/xlsx/odt/rtf → PDF con `soffice --headless`. `nombre_archivo` queda con el
 *   nombre original; `mime` y `bytes` pasan a ser los del PDF.
 * - Más de 20 MB: un PDF se intenta comprimir con ghostscript (`/ebook`); si sigue grande, o es una
 *   imagen, se salta y queda en el reporte. Nunca se parte el PDF.
 * - Idempotente: la huella sale del contenido y la fila se actualiza solo si su `ref` sigue nulo.
 * - URL y llave de servicio del entorno (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`;
 *   si existe `.env.local` en el directorio actual, se carga). No se imprimen.
 */
import '../_load-env'

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { createClient } from '@supabase/supabase-js'

import { BUCKET_PROVEEDORES, referenciaDeArchivo, rutaDeArchivo } from '@/lib/proveedores/archivos'
import {
  decidirTamano,
  emparejar,
  extensionEnBucket,
  formatoDeArchivo,
  huellaDeContenido,
  mimeDelContenido,
  type ArchivoEnCarpeta,
  type FilaImportada,
} from '@/lib/proveedores/subir-importados'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function arg(nombre: string): string | null {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`

type Listo = { fila: FilaImportada; archivo: ArchivoEnCarpeta; datos: Uint8Array; mime: string; ext: string; convertido: boolean; comprimido: boolean }
type Saltado = { archivo: ArchivoEnCarpeta; motivo: string }

/** Copia el archivo con un nombre simple (soffice y gs se enredan con nombres raros) y lo convierte. */
function convertirAPdf(origen: string, extension: string, trabajo: string): string {
  const dir = mkdtempSync(join(trabajo, 'conv-'))
  const entrada = join(dir, `entrada.${extension}`)
  copyFileSync(origen, entrada)
  execFileSync('soffice', [`-env:UserInstallation=file://${join(trabajo, 'perfil-soffice')}`, '--headless', '--convert-to', 'pdf', '--outdir', dir, entrada], { stdio: 'ignore', timeout: 300_000 })
  const salida = join(dir, 'entrada.pdf')
  if (!existsSync(salida)) throw new Error('soffice no produjo el PDF')
  return salida
}

function comprimirPdf(datos: Uint8Array, trabajo: string): Uint8Array {
  const dir = mkdtempSync(join(trabajo, 'gs-'))
  const entrada = join(dir, 'entrada.pdf')
  const salida = join(dir, 'salida.pdf')
  writeFileSync(entrada, datos)
  execFileSync('gs', ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', '-dPDFSETTINGS=/ebook', '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${salida}`, entrada], { stdio: 'ignore', timeout: 600_000 })
  return new Uint8Array(readFileSync(salida))
}

/** Lee, convierte y comprime lo que haga falta. Devuelve lo que se subiría o por qué se salta. */
function preparar(fila: FilaImportada, archivo: ArchivoEnCarpeta, carpeta: string, trabajo: string): Listo | Saltado {
  const formato = formatoDeArchivo(archivo.nombre)
  if (formato.tipo === 'no_soportado') return { archivo, motivo: `formato .${formato.extension || '(sin extensión)'} no soportado` }
  let ruta = join(carpeta, archivo.nombre)
  let convertido = false
  if (formato.tipo === 'convertir') {
    try {
      ruta = convertirAPdf(ruta, formato.extension, trabajo)
      convertido = true
    } catch (e) {
      return { archivo, motivo: `no se pudo convertir a PDF (${e instanceof Error ? e.message : e})` }
    }
  }
  let datos = new Uint8Array(readFileSync(ruta))
  const mime = mimeDelContenido(datos)
  if (!mime) return { archivo, motivo: 'el contenido no es PDF ni imagen aceptada' }
  let comprimido = false
  let decision = decidirTamano(datos.length, mime, comprimido)
  if (decision === 'comprimir') {
    try {
      const menor = comprimirPdf(datos, trabajo)
      if (mimeDelContenido(menor) === 'application/pdf' && menor.length < datos.length) datos = menor
    } catch (e) {
      console.warn(`  (no se pudo comprimir ${archivo.nombre}: ${e instanceof Error ? e.message : e})`)
    }
    comprimido = true
    decision = decidirTamano(datos.length, mime, comprimido)
  }
  if (decision === 'saltar') return { archivo, motivo: `pesa ${mb(datos.length)}${comprimido ? ' aun comprimido' : ''}; el tope es 20 MB` }
  const ext = extensionEnBucket(mime)
  if (!ext) return { archivo, motivo: `tipo ${mime} no aceptado` }
  return { fila, archivo, datos, mime, ext, convertido, comprimido }
}

async function main() {
  const workspace = arg('--workspace')?.toLowerCase() ?? null
  const carpetaArg = arg('--carpeta')
  const aplicar = process.argv.includes('--aplicar')
  if (!workspace || !UUID.test(workspace) || !carpetaArg) {
    console.error('Uso: npx tsx scripts/proveedores/subir-tarifarios-importados.ts --workspace <uuid> --carpeta <ruta> [--aplicar]')
    process.exit(1)
  }
  const carpeta = resolve(carpetaArg)
  if (!existsSync(carpeta) || !statSync(carpeta).isDirectory()) {
    console.error(`No existe la carpeta ${carpeta}`)
    process.exit(1)
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !llave) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.')
    process.exit(1)
  }
  const sb = createClient(url, llave, { auth: { persistSession: false, autoRefreshToken: false } })

  // 1. Las filas importadas del workspace (todas: las que ya tienen `ref` se reportan y no se tocan).
  const filas: FilaImportada[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb
      .from('proveedor_tarifarios')
      .select('id, proveedor_id, origen_ref, ref')
      .eq('workspace_id', workspace)
      .eq('origen', 'importacion')
      .order('id')
      .range(desde, desde + 999)
    if (error) throw new Error(`No se pudieron leer los tarifarios: ${error.message}`)
    filas.push(...((data ?? []) as FilaImportada[]))
    if (!data || data.length < 1000) break
  }

  const archivos: ArchivoEnCarpeta[] = readdirSync(carpeta)
    .filter((nombre) => statSync(join(carpeta, nombre)).isFile())
    .map((nombre) => ({ nombre, bytes: statSync(join(carpeta, nombre)).size }))

  const emp = emparejar(filas, archivos)
  console.log(aplicar ? 'MODO APLICAR: sube y actualiza.' : 'MODO PRUEBA: no escribe nada (agrega --aplicar para subir).')
  console.log(`Filas importadas: ${filas.length} (ya con archivo: ${emp.yaSubidas.length}). Archivos en la carpeta: ${archivos.length} (documentos docN que no se suben: ${emp.documentos.length}).`)
  console.log(`Emparejados: ${emp.pares.length}. Filas sin archivo: ${emp.filasSinArchivo.length}. Archivos tar sin fila: ${emp.archivosSinFila.length}. Ambiguos: ${emp.ambiguos.length}.`)

  // 2-3. Convertir y comprimir en una carpeta de trabajo.
  const trabajo = mkdtempSync(join(tmpdir(), 'subir-tarifarios-'))
  mkdirSync(join(trabajo, 'perfil-soffice'), { recursive: true })
  const listos: Listo[] = []
  const saltados: Saltado[] = []
  for (const [i, { fila, archivo }] of emp.pares.entries()) {
    process.stderr.write(`\r  preparando ${i + 1}/${emp.pares.length}…`)
    const r = preparar(fila, archivo, carpeta, trabajo)
    if ('motivo' in r) saltados.push(r)
    else listos.push(r)
  }
  process.stderr.write('\n')

  const total = listos.reduce((n, l) => n + l.datos.length, 0)
  console.log(`\nListos para subir: ${listos.length} (${mb(total)}). Convertidos a PDF: ${listos.filter((l) => l.convertido).length}. Comprimidos: ${listos.filter((l) => l.comprimido).length}. Saltados: ${saltados.length}.`)
  for (const l of listos.filter((x) => x.convertido || x.comprimido)) {
    console.log(`  ${l.convertido ? '[convertido] ' : ''}${l.comprimido ? '[comprimido] ' : ''}${l.archivo.nombre} → ${mb(l.datos.length)}`)
  }
  if (saltados.length) {
    console.log('\nSALTADOS (quedan sin archivo):')
    for (const s of saltados) console.log(`  ${s.archivo.nombre}: ${s.motivo}`)
  }
  if (emp.filasSinArchivo.length) {
    console.log('\nFILAS SIN ARCHIVO EN LA CARPETA:')
    for (const f of emp.filasSinArchivo) console.log(`  ${f.id} ${f.origen_ref}`)
  }
  if (emp.archivosSinFila.length) {
    console.log('\nARCHIVOS SIN FILA (no se suben):')
    for (const a of emp.archivosSinFila) console.log(`  ${a.nombre}`)
  }
  if (emp.ambiguos.length) {
    console.log('\nAMBIGUOS (no se adivina; se resuelven a mano):')
    for (const g of emp.ambiguos) console.log(`  filas ${g.filas.map((f) => f.id).join(', ')} ↔ ${g.archivos.map((a) => a.nombre).join(' | ')}`)
  }
  if (emp.filasSinOrigen.length) console.log(`\nFilas con origen_ref ilegible: ${emp.filasSinOrigen.map((f) => f.id).join(', ')}`)
  if (emp.otros.length) console.log(`\nArchivos con otro nombre (ignorados): ${emp.otros.length}`)

  if (!aplicar) {
    console.log(`\nLos PDF convertidos y comprimidos quedaron en ${trabajo} para revisarlos.`)
    return
  }

  // 4. Subir y actualizar, de a uno.
  let subidos = 0
  const fallas: string[] = []
  for (const l of listos) {
    const ruta = rutaDeArchivo(workspace, l.fila.proveedor_id, 'tarifarios', huellaDeContenido(l.fila.id, l.datos), l.ext)
    const { error: errSubida } = await sb.storage.from(BUCKET_PROVEEDORES).upload(ruta, l.datos, { contentType: l.mime, upsert: false })
    // La huella es de la fila y el contenido: «ya existe» es este mismo archivo de una corrida anterior.
    const yaExistia = !!errSubida && /exist|duplicate/i.test(errSubida.message)
    if (errSubida && !yaExistia) {
      fallas.push(`${l.archivo.nombre}: no subió (${errSubida.message})`)
      continue
    }
    const { data, error } = await sb
      .from('proveedor_tarifarios')
      .update({ ref: referenciaDeArchivo(ruta), bytes: l.datos.length, mime: l.mime, updated_at: new Date().toISOString() })
      .eq('id', l.fila.id)
      .eq('workspace_id', workspace)
      .is('ref', null)
      .select('id')
    if (error) {
      fallas.push(`${l.archivo.nombre}: subió pero no se actualizó la fila (${error.message}); la próxima corrida la retoma`)
      continue
    }
    if (!data || data.length === 0) {
      // Alguien le puso archivo a la fila entre la lectura y ahora: no se pisa; se borra lo subido.
      if (!yaExistia) await sb.storage.from(BUCKET_PROVEEDORES).remove([ruta])
      fallas.push(`${l.archivo.nombre}: la fila ya tenía archivo; no se tocó`)
      continue
    }
    subidos++
    process.stderr.write(`\r  subidos ${subidos}/${listos.length}`)
  }
  process.stderr.write('\n')
  rmSync(trabajo, { recursive: true, force: true })
  console.log(`\nSubidos y registrados: ${subidos}. Fallas: ${fallas.length}.`)
  for (const f of fallas) console.log(`  ${f}`)
  if (fallas.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
