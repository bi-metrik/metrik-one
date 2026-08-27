// ============================================================
// Un bloque no vive en una sola configuración.
//
// Cada bloque se declara UNA vez editable en su etapa nativa (esa es la que lleva
// `slug`) y se repite como copia de solo lectura en cada etapa posterior. Las
// copias no llevan slug: se reconocen porque comparten `nombre` dentro de la misma
// línea. Y cada copia tiene su PROPIA fila en `negocio_bloques`, así que buscar por
// el slug nativo solo encuentra lo que se cargó estando parado en la etapa nativa.
//
// Eso importa cuando lo que se busca es un HECHO del negocio y no el contenido de
// una etapa. "¿Ya hay una factura cargada?" es verdad o mentira sin importar en cuál
// de las copias quedó el archivo. Medido 2026-08-27 en SOENA: de 272 negocios sin
// facturar que ya pasaron de Cargue, 240 ni siquiera tienen fila en la configuración
// nativa — leer solo esa los daba a todos por no facturados, y la factura cargada a
// mano no contaba para nada.
//
// Server-only.
// ============================================================

/**
 * Ids de TODAS las configuraciones que son el mismo bloque a lo largo de la línea:
 * la nativa que tiene el slug, y sus copias en las etapas siguientes.
 *
 * Devuelve lista vacía si el slug no existe en esa línea. No lanza: quien la usa
 * está respondiendo una pregunta sobre el negocio, no ejecutando una orden.
 */
export async function idsDeCopiasDelBloque(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  lineaId: string,
  slugNativo: string,
): Promise<string[]> {
  const { data: nativas } = await svc
    .from('bloque_configs')
    .select('nombre, etapas_negocio!inner(linea_id)')
    .eq('slug', slugNativo)
    .eq('etapas_negocio.linea_id', lineaId)
    .limit(1)
  const nombre = ((nativas ?? [])[0] as { nombre?: string | null } | undefined)?.nombre
  // Sin nombre no hay con qué reconocer las copias. Se responde con la nativa sola
  // antes que con nada: es exactamente el comportamiento que había.
  if (!nombre) {
    const { data: sola } = await svc
      .from('bloque_configs')
      .select('id, etapas_negocio!inner(linea_id)')
      .eq('slug', slugNativo)
      .eq('etapas_negocio.linea_id', lineaId)
    return ((sola ?? []) as Array<{ id: string }>).map(c => c.id)
  }

  const { data: copias } = await svc
    .from('bloque_configs')
    .select('id, etapas_negocio!inner(linea_id)')
    .eq('nombre', nombre)
    .eq('etapas_negocio.linea_id', lineaId)
  return ((copias ?? []) as Array<{ id: string }>).map(c => c.id)
}
