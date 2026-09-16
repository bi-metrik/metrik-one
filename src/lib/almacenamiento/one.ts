import 'server-only'

// ============================================================
// Adaptador de los buckets del PROPIO proyecto de ONE (`ve-documentos`,
// `gastos-soportes`). Único lugar que los firma, lee, escribe y borra.
//
//   subirAOne({...})                 → sube y devuelve la referencia `one://`
//   enlaceTemporalOne(ref, segundos) → URL firmada de lectura
//   descargarDeOne(ref)              → bytes (extracción IA, empuje a Drive)
//   borrarDeOne(ref)
//
// ⚠️ Todo pasa por el cliente de SERVICIO, que no aplica RLS. Es deliberado: la
// autorización de estos archivos la decide `abrir.ts` (sesión + workspace de la ruta +
// puerta del negocio), no las policies del bucket. Atarlo a las policies habría dejado
// el producto dependiendo de un juego que hoy no está completo — la de SELECT de
// `gastos-soportes` se borró en `20260418000000` cuando el bucket era público.
//
// ⚠️ Estas funciones NO validan quién pide. Quien las llame ya pasó por su guard.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server'
import {
  construirReferenciaOne,
  parsearReferenciaOne,
  type BucketOne,
  type ReferenciaOne,
} from './referencia'

/** Vigencia de un enlace para abrir un archivo desde la pantalla. Igual que el externo. */
export const SEGUNDOS_ENLACE_ONE = 300

/**
 * Vigencia de un enlace que va a alguien SIN sesión en ONE: hoy el cliente final, al que
 * el aviso de etapa le manda el documento por correo y por WhatsApp.
 *
 * Siete días es una decisión de producto, no un número técnico: es el plazo acordado
 * para que el cliente alcance a abrir el documento del trámite. No se usa para nada que
 * abra alguien del equipo — ahí el enlace corto con sesión es más barato y más estrecho,
 * y es lo que hace `/api/archivos/abrir`.
 */
export const SEGUNDOS_ENLACE_SIN_SESION = 7 * 24 * 60 * 60

function bucketDe(bucket: BucketOne) {
  return createServiceClient().storage.from(bucket)
}

function partesDe(referencia: string): { bucket: BucketOne; path: string } {
  const p = parsearReferenciaOne(referencia)
  if (!p) throw new Error(`Referencia de ONE inválida: ${String(referencia).slice(0, 60)}`)
  return p
}

export interface ArchivoSubidoOne {
  referencia: ReferenciaOne
  bucket: BucketOne
  path: string
}

/**
 * Sube y devuelve la REFERENCIA, nunca una URL. Es el punto en el que un escritor deja
 * de depender de que el bucket sea público: lo que guarda en la base ya no es un enlace,
 * es una dirección estable que se firma cuando alguien la abre.
 */
export async function subirAOne(entrada: {
  bucket: BucketOne
  path: string
  cuerpo: Buffer | Uint8Array | File | Blob | ArrayBuffer
  mime?: string | null
  upsert?: boolean
}): Promise<ArchivoSubidoOne> {
  const { error } = await bucketDe(entrada.bucket).upload(entrada.path, entrada.cuerpo, {
    contentType: entrada.mime ?? undefined,
    upsert: entrada.upsert ?? true,
  })
  if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`)
  return {
    referencia: construirReferenciaOne(entrada.bucket, entrada.path),
    bucket: entrada.bucket,
    path: entrada.path,
  }
}

/** URL firmada de lectura. Lanza si el objeto no existe o Storage no responde. */
export async function enlaceTemporalOne(
  referencia: string,
  segundos: number = SEGUNDOS_ENLACE_ONE,
  opciones: { descargar?: boolean } = {},
): Promise<string> {
  const { bucket, path } = partesDe(referencia)
  const nombre = path.split('/').pop() || 'archivo'
  const { data, error } = await bucketDe(bucket).createSignedUrl(
    path,
    segundos,
    opciones.descargar ? { download: nombre } : undefined,
  )
  if (error || !data?.signedUrl) {
    throw new Error(`No se pudo abrir el archivo: ${error?.message ?? 'sin datos'}`)
  }
  return data.signedUrl
}

/**
 * Lo mismo, devolviendo `null` en vez de lanzar. Para los caminos donde el archivo es un
 * extra y no puede tumbar la operación: si el enlace no se puede firmar, quien llama
 * decide si sigue sin él en vez de fallar entero.
 */
export async function enlaceTemporalOneOpcional(
  referencia: string,
  segundos: number = SEGUNDOS_ENLACE_ONE,
  opciones: { descargar?: boolean } = {},
): Promise<string | null> {
  try {
    return await enlaceTemporalOne(referencia, segundos, opciones)
  } catch (e) {
    console.warn('[almacenamiento-one] no se pudo firmar:', e instanceof Error ? e.message : e)
    return null
  }
}

export async function descargarDeOne(referencia: string): Promise<{ buffer: Buffer; mime: string | null }> {
  const { bucket, path } = partesDe(referencia)
  const { data, error } = await bucketDe(bucket).download(path)
  if (error || !data) throw new Error(`No se pudo leer el archivo: ${error?.message ?? 'sin datos'}`)
  return { buffer: Buffer.from(await data.arrayBuffer()), mime: data.type || null }
}

export async function borrarDeOne(referencia: string): Promise<void> {
  const { bucket, path } = partesDe(referencia)
  const { error } = await bucketDe(bucket).remove([path])
  if (error) throw new Error(`No se pudo borrar el archivo: ${error.message}`)
}
