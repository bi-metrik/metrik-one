#!/usr/bin/env node
/**
 * Publica el catálogo de servicios del cerebro en MéTRIK ONE, y revisa la deriva.
 *
 * **Este archivo vive en el repositorio del CEREBRO** (`bi-metrik/metrik-system`), en
 * `scripts/sync-catalogo-servicios.mjs`. Está versionado aquí porque lo escribe Max y lo
 * aprueba Mik, y porque su contrato con ONE (la firma, el cuerpo, los códigos) se rompe si
 * alguien cambia solo un lado. Ver `docs/catalogo-servicios/README.md`.
 *
 * Spec: `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md`, §3.2.
 *
 * ## Dos modos
 *
 *   node scripts/sync-catalogo-servicios.mjs publicar [archivo…]
 *     Manda cada archivo a `POST /api/catalogo/versiones`. Sin archivos, manda todos.
 *
 *   node scripts/sync-catalogo-servicios.mjs revisar
 *     Compara las huellas locales contra `GET /api/catalogo/huellas` y falla si difieren.
 *
 * ## Qué valida ESTE script y qué no
 *
 * **No revalida el esquema.** La autoridad es ONE (`src/lib/catalogo/definicion.ts`): un
 * esquema en cada repo se desincroniza y el síntoma sería un archivo que pasa aquí y rebota
 * allá. Si el archivo está mal, ONE responde 422 con los motivos y este script los imprime.
 *
 * Lo único que valida es lo que ONE **no puede**, porque no tiene el sistema de archivos del
 * cerebro: que `precios_lista_fuente` y `tratamiento_iva_fuente` apunten a un archivo que
 * existe. Un precio o un tratamiento de IVA que cita una decisión inexistente es una cifra sin
 * respaldo, y esa es exactamente la clase de dato que no se escribe de memoria.
 *
 * ## Variables de entorno
 *
 *   ONE_URL                 https://metrikone.co  (o el preview que se quiera probar)
 *   CATALOGO_SYNC_SECRET    el mismo que tiene ONE
 */
import { createHash, createHmac } from 'node:crypto'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

const DIR = 'cerebro/catalogo/servicios'
const RUTA_VERSIONES = '/api/catalogo/versiones'
const RUTA_HUELLAS = '/api/catalogo/huellas'

const ONE = (process.env.ONE_URL || '').replace(/\/$/, '')
const SECRETO = process.env.CATALOGO_SYNC_SECRET

if (!ONE || !SECRETO) {
  console.error('Faltan ONE_URL o CATALOGO_SYNC_SECRET.')
  process.exit(2)
}

const sha256 = (t) => createHash('sha256').update(t, 'utf8').digest('hex')

/**
 * La firma, replicada de `src/lib/catalogo/firma.ts` de ONE. El mensaje es
 * `<t>.<METODO>.<ruta>.<sha256 del cuerpo>`; el método y la ruta van dentro para que una firma
 * de lectura no sirva para escribir.
 */
function cabeceraFirma(metodo, ruta, cuerpo) {
  const t = Math.floor(Date.now() / 1000)
  const mensaje = `${t}.${metodo.toUpperCase()}.${ruta}.${sha256(cuerpo)}`
  return `t=${t},v1=${createHmac('sha256', SECRETO).update(mensaje, 'utf8').digest('hex')}`
}

/** Lee `clave: valor` del frontmatter, sin interpretar nada más. Solo para citar fuentes. */
function citas(texto) {
  const salida = {}
  const lineas = texto.split('\n')
  if (lineas[0]?.trim() !== '---') return salida
  for (const l of lineas.slice(1)) {
    if (l.trim() === '---') break
    const m = /^(precios_lista_fuente|tratamiento_iva_fuente)\s*:\s*(.+?)\s*(?:#.*)?$/.exec(l)
    if (m) salida[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return salida
}

function archivosDelCatalogo(explicitos) {
  if (explicitos.length > 0) return explicitos
  if (!existsSync(DIR)) {
    console.error(`No existe ${DIR}. ¿Se corre desde la raíz del repositorio del cerebro?`)
    process.exit(2)
  }
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => join(DIR, f))
}

/** Las fuentes citadas existen como archivo del cerebro. Es lo único que ONE no puede ver. */
function fuentesQueNoExisten(ruta, texto) {
  const c = citas(texto)
  const faltan = []
  for (const [clave, slug] of Object.entries(c)) {
    // Un slug se escribe sin extensión y relativo a `cerebro/`.
    const candidatos = [join('cerebro', `${slug}.md`), join('cerebro', slug)]
    if (!candidatos.some((p) => existsSync(p))) faltan.push(`${clave}: ${slug}`)
  }
  for (const clave of ['precios_lista_fuente', 'tratamiento_iva_fuente']) {
    if (!(clave in c)) faltan.push(`${clave}: no está en el frontmatter`)
  }
  return faltan.map((f) => `${ruta} — ${f}`)
}

async function publicar(archivos) {
  let fallos = 0

  // Primero las fuentes de TODOS: un lote a medio publicar es peor que uno que no salió.
  const sinFuente = archivos.flatMap((a) => fuentesQueNoExisten(a, readFileSync(a, 'utf8')))
  if (sinFuente.length > 0) {
    console.error('Estos archivos citan una decisión o regla que no existe en el cerebro:')
    for (const s of sinFuente) console.error(`  ✗ ${s}`)
    console.error('\nUn precio o un IVA que cita algo inexistente es una cifra sin respaldo.')
    process.exit(1)
  }

  for (const archivo of archivos) {
    const texto = readFileSync(archivo, 'utf8')
    const cuerpo = JSON.stringify({ fuente_ruta: `${DIR}/${basename(archivo)}`, archivo: texto })
    const r = await fetch(`${ONE}${RUTA_VERSIONES}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-one-firma': cabeceraFirma('POST', RUTA_VERSIONES, cuerpo) },
      body: cuerpo,
    })
    const j = await r.json().catch(() => ({}))

    if (r.status === 201) console.log(`  ✓ ${basename(archivo)} — publicada v${j.version}`)
    else if (r.status === 200) console.log(`  · ${basename(archivo)} — ya estaba (v${j.version})`)
    else {
      fallos++
      console.error(`  ✗ ${basename(archivo)} — HTTP ${r.status} ${j.error ?? ''}`)
      for (const d of j.detalles ?? []) console.error(`      ${d}`)
    }
  }

  if (fallos > 0) process.exit(1)
}

async function revisar(archivos) {
  const r = await fetch(`${ONE}${RUTA_HUELLAS}`, {
    headers: { 'x-one-firma': cabeceraFirma('GET', RUTA_HUELLAS, '') },
  })
  if (!r.ok) {
    console.error(`No se pudieron leer las huellas: HTTP ${r.status}`)
    process.exit(1)
  }
  const { versiones } = await r.json()

  const problemas = []
  for (const archivo of archivos) {
    const texto = readFileSync(archivo, 'utf8')
    const ruta = `${DIR}/${basename(archivo)}`
    const huella = sha256(texto)
    const enOne = versiones.filter((v) => v.fuente_ruta === ruta)

    if (enOne.length === 0) {
      problemas.push(`${basename(archivo)}: no está publicado en ONE`)
      continue
    }
    // Deriva: el archivo de hoy tiene que corresponder a ALGUNA versión publicada. Si no
    // corresponde a ninguna, o cambió sin subir la versión, o la versión nueva no se publicó.
    if (!enOne.some((v) => v.fuente_sha256 === huella)) {
      problemas.push(
        `${basename(archivo)}: el archivo no corresponde a ninguna versión publicada ` +
          `(publicadas: ${enOne.map((v) => `v${v.version}`).join(', ')}). ` +
          'O cambió sin subir la versión, o la versión nueva nunca llegó a ONE.',
      )
    }
  }

  // Al revés: algo publicado en ONE cuyo archivo ya no existe en el cerebro.
  const rutasLocales = new Set(archivos.map((a) => `${DIR}/${basename(a)}`))
  for (const v of versiones) {
    if (!rutasLocales.has(v.fuente_ruta)) {
      problemas.push(`${v.fuente_ruta} v${v.version} está en ONE y el archivo no está en el cerebro`)
    }
  }

  if (problemas.length > 0) {
    console.error('Deriva entre el cerebro y ONE:')
    for (const p of problemas) console.error(`  ✗ ${p}`)
    process.exit(1)
  }
  console.log(`Sin deriva: ${archivos.length} archivo(s) corresponden a lo publicado en ONE.`)
}

const [modo, ...resto] = process.argv.slice(2)
const archivos = archivosDelCatalogo(resto.filter((a) => a.endsWith('.md')))

if (modo === 'publicar') await publicar(archivos)
else if (modo === 'revisar') await revisar(archivos)
else {
  console.error('Uso: sync-catalogo-servicios.mjs publicar|revisar [archivo.md…]')
  process.exit(2)
}
