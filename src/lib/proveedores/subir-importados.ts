/**
 * Las decisiones del script que sube los archivos de los tarifarios importados de Airtable
 * (`scripts/proveedores/subir-tarifarios-importados.ts`). Puro: no toca la red, ni el disco, ni
 * `soffice`/`gs`; el script hace eso y le pregunta a este módulo qué hacer.
 *
 * El emparejamiento: la importación guardó en cada tarifario `origen_ref = '<recAirtable>:<nombre
 * original>'` (cortado a 400 caracteres). Los archivos bajados de Airtable se llaman
 * `<recAirtable>_<tarN|docN>_<nombre>`, pero el que los bajó cambió por `_` los caracteres raros del
 * nombre (paréntesis, comas, `%`, `+` y las tildes que venían como letra + marca combinada). Por eso
 * se compara una CLAVE del nombre que hace lo mismo con los dos lados, no el nombre tal cual.
 */
import { createHash } from 'node:crypto'

import { BYTES_MAXIMOS_ARCHIVO, extensionDeMime } from './archivos'

/** Lo que el script necesita de cada fila de `proveedor_tarifarios` con `origen = 'importacion'`. */
export type FilaImportada = {
  id: string
  proveedor_id: string
  origen_ref: string | null
  ref: string | null
}

export type ArchivoEnCarpeta = {
  /** El nombre en disco, tal cual. */
  nombre: string
  bytes: number
}

export type NombreEnDisco = { rec: string; clase: 'tar' | 'doc'; indice: number; original: string }

const NOMBRE_EN_DISCO = /^(rec[A-Za-z0-9]+)_(tar|doc)(\d+)_(.+)$/s
/** Lo que `origen_ref` puede medir como máximo (CHECK de la tabla y `importar-airtable.ts`). */
export const LARGO_MAXIMO_ORIGEN_REF = 400

/** `<rec>_<tarN|docN>_<nombre>` → sus partes. Cualquier otro nombre → `null`. */
export function partesDeNombreEnDisco(nombre: string): NombreEnDisco | null {
  const m = NOMBRE_EN_DISCO.exec(nombre)
  if (!m) return null
  return { rec: m[1], clase: m[2] as 'tar' | 'doc', indice: Number(m[3]), original: m[4] }
}

/**
 * La clave con la que se comparan los nombres: descompuesto (NFD), y todo lo que no sea letra o
 * número ASCII, espacio, punto o guion pasa a `_`; sin distinguir mayúsculas. Es idempotente, así
 * que el nombre ya saneado en disco y el original de Airtable dan la misma clave («Año (1).pdf» y
 * «An_o _1_.pdf» → «an_o _1_.pdf»).
 */
export function claveDeNombre(nombre: string): string {
  return nombre.normalize('NFD').replace(/[^A-Za-z0-9 .-]/g, '_').toLowerCase()
}

/** `'<rec>:<nombre>'` → sus partes (el nombre puede tener `:`; se corta en el primero). */
export function partesDeOrigenRef(origenRef: string | null): { rec: string; original: string } | null {
  if (!origenRef) return null
  const i = origenRef.indexOf(':')
  if (i <= 0 || i === origenRef.length - 1) return null
  return { rec: origenRef.slice(0, i), original: origenRef.slice(i + 1) }
}

function nombreCoincide(fila: { rec: string; original: string; cortado: boolean }, archivo: NombreEnDisco): boolean {
  if (fila.rec !== archivo.rec) return false
  const deFila = claveDeNombre(fila.original)
  const deArchivo = claveDeNombre(archivo.original)
  // Si la importación cortó `origen_ref` a 400, el nombre de la fila es solo el comienzo.
  return fila.cortado ? deArchivo.startsWith(deFila) : deArchivo === deFila
}

export type Emparejamiento = {
  /** Fila sin archivo todavía + su único archivo: lo que se sube. */
  pares: { fila: FilaImportada; archivo: ArchivoEnCarpeta }[]
  /** Filas con `ref` lleno: ya tienen archivo; no se tocan (y su archivo en disco tampoco). */
  yaSubidas: FilaImportada[]
  /** Filas sin `ref` que no encontraron archivo en la carpeta. */
  filasSinArchivo: FilaImportada[]
  /** Archivos `tarN` que no encontraron fila. */
  archivosSinFila: ArchivoEnCarpeta[]
  /** Una fila con varios archivos posibles o un archivo con varias filas: no se adivina. */
  ambiguos: { filas: FilaImportada[]; archivos: ArchivoEnCarpeta[] }[]
  /** Archivos `docN` (documentos/certificaciones): no son tarifarios, no se suben aquí. */
  documentos: ArchivoEnCarpeta[]
  /** Archivos con otro nombre (no `<rec>_<tarN|docN>_…`). */
  otros: ArchivoEnCarpeta[]
  /** Filas con `origen_ref` que no se entiende. */
  filasSinOrigen: FilaImportada[]
}

/**
 * Empareja filas y archivos por `origen_ref`. Un par solo cuenta si es uno a uno: la fila tiene un
 * solo archivo posible y ese archivo una sola fila. Lo demás va al reporte, sin fallar.
 */
export function emparejar(filas: FilaImportada[], archivos: ArchivoEnCarpeta[]): Emparejamiento {
  const r: Emparejamiento = { pares: [], yaSubidas: [], filasSinArchivo: [], archivosSinFila: [], ambiguos: [], documentos: [], otros: [], filasSinOrigen: [] }

  const tarifas: { archivo: ArchivoEnCarpeta; partes: NombreEnDisco }[] = []
  for (const archivo of archivos) {
    const partes = partesDeNombreEnDisco(archivo.nombre)
    if (!partes) r.otros.push(archivo)
    else if (partes.clase === 'doc') r.documentos.push(archivo)
    else tarifas.push({ archivo, partes })
  }

  const conOrigen: { fila: FilaImportada; rec: string; original: string; cortado: boolean }[] = []
  for (const fila of filas) {
    const p = partesDeOrigenRef(fila.origen_ref)
    if (!p) r.filasSinOrigen.push(fila)
    else conOrigen.push({ fila, ...p, cortado: (fila.origen_ref ?? '').length >= LARGO_MAXIMO_ORIGEN_REF })
  }

  // Candidatos en los dos sentidos (todas las filas, también las ya subidas: su archivo no es «sin fila»).
  const archivosDeFila = new Map<number, number[]>()
  const filasDeArchivo = new Map<number, number[]>()
  conOrigen.forEach((f, i) => {
    tarifas.forEach((t, j) => {
      if (!nombreCoincide(f, t.partes)) return
      archivosDeFila.set(i, [...(archivosDeFila.get(i) ?? []), j])
      filasDeArchivo.set(j, [...(filasDeArchivo.get(j) ?? []), i])
    })
  })

  const archivoUsado = new Set<number>()
  const grupoVisto = new Set<string>()
  conOrigen.forEach((f, i) => {
    const cand = archivosDeFila.get(i) ?? []
    for (const j of cand) archivoUsado.add(j)
    if (f.fila.ref) {
      r.yaSubidas.push(f.fila)
      return
    }
    if (cand.length === 0) {
      r.filasSinArchivo.push(f.fila)
      return
    }
    const filasDelArchivo = cand.length === 1 ? filasDeArchivo.get(cand[0]) ?? [] : []
    if (cand.length === 1 && filasDelArchivo.length === 1) {
      r.pares.push({ fila: f.fila, archivo: tarifas[cand[0]].archivo })
      return
    }
    // Ambiguo: el grupo son las filas y archivos conectados a esta fila (se reporta una vez).
    const filasGrupo = new Set<number>([i])
    for (const j of cand) for (const k of filasDeArchivo.get(j) ?? []) filasGrupo.add(k)
    const llave = [...filasGrupo].sort((a, b) => a - b).join(',')
    if (grupoVisto.has(llave)) return
    grupoVisto.add(llave)
    const archivosGrupo = new Set<number>()
    for (const k of filasGrupo) for (const j of archivosDeFila.get(k) ?? []) archivosGrupo.add(j)
    r.ambiguos.push({ filas: [...filasGrupo].map((k) => conOrigen[k].fila), archivos: [...archivosGrupo].map((j) => tarifas[j].archivo) })
  })
  tarifas.forEach((t, j) => {
    if (!archivoUsado.has(j)) r.archivosSinFila.push(t.archivo)
  })
  return r
}

// ── Formato ──────────────────────────────────────────────────────────────────

const MIME_DE_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** Lo que LibreOffice (`soffice --convert-to pdf`) pasa a PDF. */
const CONVERTIBLES = new Set(['doc', 'docx', 'ppt', 'pptx', 'odt', 'odp', 'rtf', 'xls', 'xlsx', 'ods'])

export type Formato = { tipo: 'directo'; mime: string } | { tipo: 'convertir'; extension: string } | { tipo: 'no_soportado'; extension: string }

export function extensionDe(nombre: string): string {
  const i = nombre.lastIndexOf('.')
  return i >= 0 ? nombre.slice(i + 1).toLowerCase() : ''
}

/** PDF o imagen aceptada → se sube tal cual; Office → se convierte a PDF; lo demás no se sube. */
export function formatoDeArchivo(nombre: string): Formato {
  const extension = extensionDe(nombre)
  const mime = MIME_DE_EXTENSION[extension]
  if (mime) return { tipo: 'directo', mime }
  if (CONVERTIBLES.has(extension)) return { tipo: 'convertir', extension }
  return { tipo: 'no_soportado', extension }
}

/** El tipo real por los primeros bytes (la extensión puede mentir). `null` si no es PDF ni imagen aceptada. */
export function mimeDelContenido(datos: Uint8Array): string | null {
  const b = (i: number) => datos[i]
  if (datos.length >= 5 && b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46 && b(4) === 0x2d) return 'application/pdf'
  if (datos.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg'
  if (datos.length >= 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png'
  if (datos.length >= 12 && b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'image/webp'
  return null
}

// ── Tamaño ───────────────────────────────────────────────────────────────────

export type DecisionTamano = 'cabe' | 'comprimir' | 'saltar'

/**
 * ≤ 20 MB cabe. Un PDF más grande se intenta comprimir UNA vez (ghostscript `/ebook`); si después
 * sigue grande, o si es una imagen, se salta (no se parte el PDF).
 */
export function decidirTamano(bytes: number, mime: string, yaComprimido: boolean, maximo = BYTES_MAXIMOS_ARCHIVO): DecisionTamano {
  if (bytes <= maximo) return 'cabe'
  if (mime === 'application/pdf' && !yaComprimido) return 'comprimir'
  return 'saltar'
}

// ── Ruta ─────────────────────────────────────────────────────────────────────

/**
 * La huella del archivo en el bucket: 32 hex, la misma forma que la subida de la app
 * (`randomBytes(16)`), pero sacada de la fila y del CONTENIDO. Así una corrida que subió y no alcanzó
 * a escribir la fila reusa el mismo objeto la vez siguiente en vez de dejar un huérfano; y dos filas
 * con el mismo archivo no comparten objeto (borrar una no le quita el archivo a la otra).
 */
export function huellaDeContenido(filaId: string, datos: Uint8Array): string {
  return createHash('sha256').update(`${filaId}:`).update(datos).digest('hex').slice(0, 32)
}

/** La extensión con la que va al bucket (`pdf|jpg|png|webp`), o `null` si el tipo no se acepta. */
export function extensionEnBucket(mime: string): string | null {
  return extensionDeMime(mime)
}
