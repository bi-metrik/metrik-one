import 'server-only'

// ============================================================
// Adaptador de almacenamiento `supabase_externo`: el proyecto Supabase del propio
// cliente (hoy Trappvel). Único lugar de ONE que habla con ese proyecto.
//
//   destinoNegocio(negocioId)            → prefijo `negocios/<id>/` (no crea nada)
//   subirArchivo({...})                  → sube desde el servidor, deja referencia
//   urlSubida(path)                      → URL firmada para que el NAVEGADOR suba directo
//   consolidarPendiente({...})           → mueve una subida pendiente a su nombre final
//   enlaceTemporal(ref, segundos)        → URL firmada de lectura
//   descargar(ref)                       → bytes (lo usa la extracción IA)
//   borrar(ref)
//   verificar()                          → consulta de salud (anti-pausa del plan Free)
//
// Cada subida deja una fila en `archivos_one` del proyecto externo: es el inventario
// que Trappvel puede leer sin pasar por ONE y, de paso, la actividad de BASE que evita
// la pausa por inactividad. El inventario es best-effort: si la tabla falla, el archivo
// igual queda guardado (es lo que el usuario necesita) y el fallo se registra; el cron
// de salud lo vuelve visible todos los días.
//
// ⚠️ La llave no se loguea, no viaja en errores y no sale del servidor.
// ============================================================

import { createHash } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { configAlmacenamiento } from './proveedor'
import { ErrorAlmacenamiento } from './config'
import {
  BUCKET_ARCHIVOS,
  construirReferencia,
  negocioDeRuta,
  parsearReferencia,
  prefijoNegocio,
  rutaArchivoNegocio,
} from './referencia'

export const TABLA_INVENTARIO = 'archivos_one'

/** Vigencia de un enlace para abrir un archivo desde la pantalla. */
export const SEGUNDOS_ENLACE = 300

export interface ArchivoGuardado {
  referencia: string
  path: string
  bytes: number
  sha256: string
}

export interface SalidaVerificacion {
  ok: boolean
  detalle: string
  ultimaSubida: string | null
}

const clientes = new Map<string, SupabaseClient>()

function clienteDe(url: string, llave: string): SupabaseClient {
  // La clave del cache no contiene la llave: solo una huella corta, por si rota.
  const huella = createHash('sha256').update(llave).digest('hex').slice(0, 12)
  const clave = `${url}#${huella}`
  const hit = clientes.get(clave)
  if (hit) return hit
  const c = createClient(url, llave, { auth: { persistSession: false, autoRefreshToken: false } })
  clientes.set(clave, c)
  return c
}

export class AlmacenamientoSupabaseExterno {
  private readonly sb: SupabaseClient

  constructor(
    readonly slug: string,
    url: string,
    llave: string,
  ) {
    this.sb = clienteDe(url, llave)
  }

  private bucket() {
    return this.sb.storage.from(BUCKET_ARCHIVOS)
  }

  /** La ruta de una referencia de ESTE bucket. Cualquier otra cosa se rechaza. */
  pathDe(referencia: string): string {
    const r = parsearReferencia(referencia)
    if (!r || r.bucket !== BUCKET_ARCHIVOS) {
      throw new ErrorAlmacenamiento('Referencia de archivo inválida')
    }
    return r.path
  }

  destinoNegocio(negocioId: string): string {
    return prefijoNegocio(negocioId)
  }

  async subirArchivo(a: {
    negocioId: string
    subcarpeta?: string | null
    nombre: string
    buffer: Buffer
    mime: string
    tipoBloque?: string | null
  }): Promise<ArchivoGuardado> {
    const path = rutaArchivoNegocio(a.negocioId, a.subcarpeta, a.nombre)
    const { error } = await this.bucket().upload(path, a.buffer, { contentType: a.mime, upsert: true })
    if (error) {
      throw new Error(`No se pudo guardar el archivo en el almacenamiento de ${this.slug}: ${error.message}`)
    }
    const guardado = {
      referencia: construirReferencia(BUCKET_ARCHIVOS, path),
      path,
      bytes: a.buffer.length,
      sha256: createHash('sha256').update(a.buffer).digest('hex'),
    }
    await this.registrarInventario({ ...guardado, negocioId: a.negocioId, mime: a.mime, tipoBloque: a.tipoBloque })
    return guardado
  }

  async urlSubida(path: string): Promise<{ signedUrl: string; referencia: string }> {
    const { data, error } = await this.bucket().createSignedUploadUrl(path, { upsert: true })
    if (error || !data) {
      throw new Error(`No se pudo preparar la subida (${this.slug}): ${error?.message ?? 'sin datos'}`)
    }
    return { signedUrl: data.signedUrl, referencia: construirReferencia(BUCKET_ARCHIVOS, path) }
  }

  /**
   * Lleva una subida pendiente a su nombre definitivo y la inventaría.
   * Devuelve también los bytes: quien confirma casi siempre los necesita (extracción IA).
   */
  async consolidarPendiente(a: {
    origen: string
    negocioId: string
    subcarpeta?: string | null
    nombre: string
    mime: string
    tipoBloque?: string | null
  }): Promise<ArchivoGuardado & { buffer: Buffer; mime: string }> {
    const origen = this.pathDe(a.origen)
    if (negocioDeRuta(origen) !== a.negocioId.toLowerCase()) {
      throw new ErrorAlmacenamiento('La subida no pertenece a este negocio')
    }
    const destino = rutaArchivoNegocio(a.negocioId, a.subcarpeta, a.nombre)

    if (destino !== origen) {
      // `move` no pisa: si ya había un archivo con ese nombre (reemplazo), se quita
      // primero. Quitar un objeto inexistente no es error en Storage.
      const { error: rmErr } = await this.bucket().remove([destino])
      if (rmErr) throw new Error(`No se pudo reemplazar el archivo anterior (${this.slug}): ${rmErr.message}`)
      const { error: mvErr } = await this.bucket().move(origen, destino)
      if (mvErr) throw new Error(`No se pudo confirmar el archivo (${this.slug}): ${mvErr.message}`)
    }

    const { buffer, mime } = await this.descargarPath(destino)
    const guardado = {
      referencia: construirReferencia(BUCKET_ARCHIVOS, destino),
      path: destino,
      bytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    }
    const mimeFinal = mime || a.mime
    await this.registrarInventario({ ...guardado, negocioId: a.negocioId, mime: mimeFinal, tipoBloque: a.tipoBloque })
    return { ...guardado, buffer, mime: mimeFinal }
  }

  async enlaceTemporal(
    referencia: string,
    segundos: number = SEGUNDOS_ENLACE,
    opciones: { descargar?: boolean } = {},
  ): Promise<string> {
    const path = this.pathDe(referencia)
    const nombre = path.split('/').pop() || 'archivo'
    const { data, error } = await this.bucket().createSignedUrl(
      path,
      segundos,
      opciones.descargar ? { download: nombre } : undefined,
    )
    if (error || !data?.signedUrl) {
      throw new Error(`No se pudo abrir el archivo (${this.slug}): ${error?.message ?? 'sin datos'}`)
    }
    return data.signedUrl
  }

  async descargar(referencia: string): Promise<{ buffer: Buffer; mime: string | null }> {
    return this.descargarPath(this.pathDe(referencia))
  }

  private async descargarPath(path: string): Promise<{ buffer: Buffer; mime: string | null }> {
    const { data, error } = await this.bucket().download(path)
    if (error || !data) {
      throw new Error(`No se pudo leer el archivo (${this.slug}): ${error?.message ?? 'sin datos'}`)
    }
    return { buffer: Buffer.from(await data.arrayBuffer()), mime: data.type || null }
  }

  async borrar(referencia: string): Promise<void> {
    const path = this.pathDe(referencia)
    const { error } = await this.bucket().remove([path])
    if (error) throw new Error(`No se pudo borrar el archivo (${this.slug}): ${error.message}`)
  }

  private async registrarInventario(f: ArchivoGuardado & {
    negocioId: string
    mime: string | null
    tipoBloque?: string | null
  }): Promise<void> {
    try {
      const { error } = await this.sb.from(TABLA_INVENTARIO).insert({
        path: f.path,
        negocio_id: f.negocioId.toLowerCase(),
        workspace_slug: this.slug,
        tipo_bloque: f.tipoBloque ?? null,
        mime: f.mime,
        bytes: f.bytes,
        sha256: f.sha256,
      })
      if (error) {
        console.error(
          `[almacenamiento:${this.slug}] el archivo quedó guardado pero ${TABLA_INVENTARIO} no aceptó la fila ` +
            `(${error.code ?? 'sin código'}): ${error.message}`,
        )
      }
    } catch (e) {
      console.error(
        `[almacenamiento:${this.slug}] el archivo quedó guardado pero ${TABLA_INVENTARIO} falló:`,
        e instanceof Error ? e.message : String(e),
      )
    }
  }

  /**
   * Una consulta real a la base del proyecto externo.
   *
   * ⚠️ NO usar `select(..., { head: true, count: 'exact' })`: medido contra el proyecto de
   * Trappvel el 2026-09-14, ese HEAD sobre una tabla que NO existe devuelve 204 sin
   * error y `count: null`. La verificación saldría verde con la tabla ausente. Un GET
   * con `limit(1)` sí devuelve PGRST205.
   */
  async verificar(): Promise<SalidaVerificacion> {
    const problemas: string[] = []
    let ultimaSubida: string | null = null

    const { data, error } = await this.sb
      .from(TABLA_INVENTARIO)
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) {
      problemas.push(`${TABLA_INVENTARIO}: ${error.code ?? ''} ${error.message}`.trim())
    } else {
      ultimaSubida = ((data ?? [])[0] as { created_at?: string } | undefined)?.created_at ?? null
    }

    const { error: lsErr } = await this.bucket().list('negocios', { limit: 1 })
    if (lsErr) problemas.push(`bucket ${BUCKET_ARCHIVOS}: ${lsErr.message}`)

    return problemas.length === 0
      ? { ok: true, detalle: 'ok', ultimaSubida }
      : { ok: false, detalle: problemas.join(' | '), ultimaSubida }
  }
}

/**
 * El adaptador externo de un workspace, o `null` si el workspace está en Drive.
 * Lanza `ErrorAlmacenamiento` si el workspace declara `supabase_externo` y falta
 * la URL o la variable de entorno: nunca devuelve null en ese caso, porque null
 * significa "usa Drive".
 */
export async function almacenamientoExternoDe(workspaceId: string): Promise<AlmacenamientoSupabaseExterno | null> {
  const cfg = await configAlmacenamiento(workspaceId)
  if (cfg.proveedor === 'drive') return null
  return new AlmacenamientoSupabaseExterno(cfg.slug, cfg.url, cfg.llave)
}
