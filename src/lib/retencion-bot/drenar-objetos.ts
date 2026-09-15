/**
 * Borra de Storage los PDF de las aceptaciones que la purga ya eliminó.
 *
 * POR QUÉ NO LO HACE LA PROPIA PURGA. `purgar_registros_bot()` es SQL, y desde
 * SQL un archivo de Storage no se puede borrar de verdad: quitar la fila de
 * `storage.objects` deja el binario huérfano en el almacenamiento, y Supabase
 * además rechaza ese DELETE directo. Así que la purga ENCOLA la ruta en
 * `purga_storage_pendiente` (en la misma transacción en que borra la fila) y
 * esto la vacía con la API de Storage. Si falla, la ruta sigue en la cola y se
 * reintenta mañana: la cola es lo que impide que un PDF se quede para siempre.
 *
 * Vive fuera de la ruta del cron porque un `route.ts` de Next no puede exportar
 * nada más que sus handlers, y la lógica se prueba con un doble del cliente.
 */
import { BUCKETS_PURGABLES } from './plazos'

export interface ObjetoPendiente {
  id: string
  bucket: string
  ruta: string
}

interface ErrorSupabase {
  message: string
}

/** Lo mínimo del cliente de Supabase (service_role) que esto usa. */
export interface ClienteDrenaje {
  rpc(fn: 'objetos_purga_bot_por_borrar'): PromiseLike<{
    data: ObjetoPendiente[] | null
    error: ErrorSupabase | null
  }>
  storage: {
    from(bucket: string): {
      remove(rutas: string[]): PromiseLike<{ error: ErrorSupabase | null }>
    }
  }
  from(tabla: 'purga_storage_pendiente'): {
    delete(): {
      in(columna: 'id', ids: string[]): PromiseLike<{ error: ErrorSupabase | null }>
    }
  }
}

export interface ResultadoDrenaje {
  ok: boolean
  /** Rutas que Storage aceptó borrar y que salieron de la cola. */
  borrados: number
  /** Filas de la cola que no se tocaron: bucket ajeno o ruta ilegible. */
  ignorados: number
  error?: string
}

/**
 * La ruta de la cola viene de una URL firmada, así que puede venir con
 * `%20` y compañía; la API de Storage espera el nombre del objeto. Null si
 * no se puede decodificar: mejor dejarla en la cola que borrar otro archivo.
 */
function nombreDelObjeto(ruta: string): string | null {
  try {
    const nombre = decodeURIComponent(ruta)
    return nombre.length > 0 && !nombre.startsWith('/') ? nombre : null
  } catch {
    return null
  }
}

export async function drenarObjetosPurgados(cliente: ClienteDrenaje): Promise<ResultadoDrenaje> {
  const { data, error } = await cliente.rpc('objetos_purga_bot_por_borrar')
  if (error) return { ok: false, borrados: 0, ignorados: 0, error: error.message }

  const porBucket = new Map<string, { ids: string[]; nombres: string[] }>()
  let ignorados = 0

  for (const fila of data ?? []) {
    const nombre = nombreDelObjeto(fila.ruta)
    if (!BUCKETS_PURGABLES.includes(fila.bucket) || nombre === null) {
      ignorados++
      continue
    }
    const grupo = porBucket.get(fila.bucket) ?? { ids: [], nombres: [] }
    grupo.ids.push(fila.id)
    grupo.nombres.push(nombre)
    porBucket.set(fila.bucket, grupo)
  }

  let borrados = 0
  for (const [bucket, { ids, nombres }] of porBucket) {
    // Un objeto que ya no existe no es error para Storage: la cola se vacía igual.
    const { error: eBorrar } = await cliente.storage.from(bucket).remove(nombres)
    if (eBorrar) {
      // La cola NO se toca: sin confirmación de Storage, la ruta se reintenta mañana.
      return { ok: false, borrados, ignorados, error: `${bucket}: ${eBorrar.message}` }
    }
    const { error: eCola } = await cliente.from('purga_storage_pendiente').delete().in('id', ids)
    if (eCola) {
      // El archivo ya se borró; la fila vuelve a salir mañana y Storage la ignora.
      return { ok: false, borrados, ignorados, error: `cola: ${eCola.message}` }
    }
    borrados += ids.length
  }

  return { ok: true, borrados, ignorados }
}
