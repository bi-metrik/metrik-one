import { bloqueLeyendo } from '@/lib/documentos/lectura-en-curso'

/**
 * Los documentos del negocio que se están leyendo ahora mismo (marca `leyendo` vigente).
 *
 * Mientras un documento se lee, el avance de etapa espera. La marca ya deja el bloque
 * `pendiente`, que frena a `puede_avanzar_etapa` si el bloque es gate; esto cubre lo demás:
 * los cruces leen el `_cross_check` y los campos del documento ANTERIOR hasta que la lectura
 * termina, y decidir con ellos sería decidir con un documento que ya se reemplazó.
 *
 * Solo frena una lectura VIGENTE: la que pasó de plazo (la función murió) se trata como
 * vencida y no deja el negocio varado.
 *
 * Devuelve el nombre de cada bloque, para decirlo en el bloqueo.
 */
export async function documentosLeyendo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioId: string,
  ahora: number = Date.now(),
): Promise<string[]> {
  // Un error leyendo NO frena: el gate de siempre sigue corriendo detrás, y frenar por una
  // consulta caída dejaría el negocio sin poder avanzar sin motivo visible.
  let data: unknown
  try {
    const r = await supabase
      .from('negocio_bloques')
      .select('data, bloque_configs(nombre)')
      .eq('negocio_id', negocioId)
      .eq('data->_lectura->>estado', 'leyendo')
    if (r?.error) return []
    data = r?.data
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  return (data as { data: unknown; bloque_configs?: { nombre?: string | null } | null }[])
    .filter(f => bloqueLeyendo(f.data, ahora))
    .map(f => f.bloque_configs?.nombre?.trim() || 'Documento')
}

/** El texto del bloqueo, uno por documento. */
export function mensajeDocumentoLeyendo(nombre: string): string {
  return `${nombre}: el documento se está leyendo. Espera a que termine para avanzar.`
}
