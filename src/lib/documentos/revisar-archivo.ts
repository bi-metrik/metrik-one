/**
 * Revisa que un archivo se pueda leer ANTES de mandarlo al modelo: es más barato, no depende del
 * proveedor y permite parar antes de cualquier paso destructivo (borrar el archivo anterior de Drive).
 *
 * Solo dice que no cuando está seguro: vacío, un PDF que no abre, cifrado o sin páginas, y un formato
 * que la lectura no acepta. Lo demás pasa y, si el modelo igual lo rechaza, `motivoDesdeRespuestaModelo`
 * lo clasifica. Nunca lanza.
 */
import { PDFDocument } from 'pdf-lib'
import { getDocumentProxy } from 'unpdf'

import { mimeDeContenido } from './mime'
import { MENSAJES_ARCHIVO, type MotivoArchivo } from './aviso-archivo'

/** Lo que la lectura de documentos acepta (`extract-fields`, `reconocer-documento`). */
const LEIBLES = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

export type RevisionArchivo = { ok: true } | { ok: false; motivo: MotivoArchivo; mensaje: string }

const no = (motivo: MotivoArchivo): RevisionArchivo => ({ ok: false, motivo, mensaje: MENSAJES_ARCHIVO[motivo] })

export async function revisarArchivo(buffer: Buffer | Uint8Array, mimeDeclarado: string): Promise<RevisionArchivo> {
  if (!buffer || buffer.length === 0) return no('vacio')
  // Manda el contenido; el nombre es el respaldo (ver `mime.ts`).
  const mime = (mimeDeContenido(buffer) ?? mimeDeclarado ?? '').toLowerCase()
  if (!LEIBLES.has(mime)) return no('formato')
  if (mime !== 'application/pdf') return { ok: true }

  // Dos lectores, porque ninguno solo alcanza: pdf.js informa UNA página en un PDF que no tiene ninguna
  // (lo rellena), y pdf-lib no distingue un PDF con contraseña de apertura de uno que solo restringe la
  // impresión, que el modelo sí lee (los certificados de banco suelen venir así). pdf-lib cuenta las
  // páginas; pdf.js dice si pide contraseña. Solo si NINGUNO lo abre, el archivo está dañado.
  let paginas: number | null = null
  try {
    // Copias: los dos lectores pueden quedarse con el ArrayBuffer, y el original se sigue usando.
    paginas = (await PDFDocument.load(new Uint8Array(buffer), { ignoreEncryption: true })).getPageCount()
  } catch {
    // pdf-lib no lo abre: decide pdf.js.
  }
  if (paginas === 0) return no('sin_paginas')

  try {
    await getDocumentProxy(new Uint8Array(buffer))
    return { ok: true }
  } catch (err) {
    const nombre = (err as { name?: string })?.name ?? ''
    const texto = String((err as { message?: string })?.message ?? err)
    if (nombre === 'PasswordException' || /password/i.test(texto)) return no('protegido')
    if (paginas !== null) return { ok: true }
    console.warn('[revisar-archivo] el PDF no abre:', texto.slice(0, 160))
    return no('danado')
  }
}
