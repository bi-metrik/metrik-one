// ============================================================
// Escribir una marca dentro de `negocios.metadata` sin borrar lo que otro
// escribió en el medio.
//
// ⚠️ El defecto que este módulo existe para cerrar: `metadata` es UNA columna
// jsonb con varias marcas adentro (`siigo_cliente`, `siigo_factura`,
// `siigo_recibo`, `facturacion_descartada`, `reproceso`…), y guardarlas con
// PostgREST obliga a leer, fusionar en memoria y escribir el objeto completo.
// Cuando entre esa lectura y esa escritura corre otra cosa que también escribe
// `metadata`, el `update` la PISA — sin error, sin aviso, y con la fila
// quedando "bien guardada".
//
// Pasó de verdad. `emitirFacturaNegocio` leía el negocio al empezar, llamaba a
// `asegurarClienteSiigo` (que reescribe `siigo_cliente` con la identificación
// buena cuando la marca vieja no coincide con el RUT) y al final guardaba
// `siigo_factura` sobre la copia vieja: la corrección del tercero se deshacía en
// el mismo acto de facturar. Medido en producción el 2026-09-02: 12 negocios
// facturados quedaron con `siigo_cliente.identificacion` igual a la cédula del
// RUT MENOS su último dígito, secuela de la heurística `nit_sin_dv` que el
// arreglo de `asegurarClienteSiigo` ya había corregido y esto volvía a sembrar.
//
// Server-only.
// ============================================================

/**
 * Fusión pura: el resto de `metadata` se conserva y solo se reemplaza `clave`.
 *
 * Se expone aparte de la escritura para poder probar la fusión sin base de
 * datos, y para que quien ya tenga la metadata fresca en la mano no repita la
 * expresión a mano (que es como nacen las variantes que se desincronizan).
 */
export function fusionarMarca(
  metadataActual: Record<string, unknown> | null | undefined,
  clave: string,
  marca: unknown,
): Record<string, unknown> {
  return { ...(metadataActual ?? {}), [clave]: marca }
}

export type ResultadoMarca = { ok: true } | { ok: false; mensaje: string }

/**
 * Guarda `marca` bajo `clave` en `negocios.metadata` fusionando sobre el estado
 * de AHORA, no sobre la copia que quien llama leyó al empezar.
 *
 * La relectura es el punto entero del helper: pasa justo antes del `update`, así
 * que cualquier escritura intermedia (la del tercero de Siigo, la de otra marca)
 * sobrevive.
 *
 * ⚠️ Si la relectura falla, se escribe igual fusionando sobre `metadataRespaldo`
 * y se avisa por consola. Es una decisión deliberada y asimétrica: la marca de un
 * documento fiscal ya emitido es lo único irrecuperable —sin ella el caso vuelve
 * a la cola y alguien podría re-emitir—, mientras que `siigo_cliente` es una
 * caché que se rehace sola (`marcaSigueValida` la compara contra el RUT y repite
 * el camino). Entre perder la marca de la factura y perder una caché, se pierde
 * la caché.
 */
export async function guardarMarcaEnMetadata(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  negocioId: string,
  clave: string,
  marca: unknown,
  metadataRespaldo: Record<string, unknown> | null | undefined = null,
): Promise<ResultadoMarca> {
  const { data, error: errLeer } = await svc
    .from('negocios')
    .select('metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  let base: Record<string, unknown> | null | undefined
  if (errLeer || !data) {
    console.error(
      `[metadata] no se pudo releer el negocio antes de guardar "${clave}"; ` +
      `se fusiona sobre la copia previa y lo que otro haya escrito en el medio se pierde: ` +
      `${errLeer?.message ?? 'sin fila'}`,
    )
    base = metadataRespaldo
  } else {
    base = (data as { metadata: Record<string, unknown> | null }).metadata
  }

  const metadata = fusionarMarca(base, clave, marca)
  const { error } = await svc
    .from('negocios')
    .update({ metadata })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
  if (error) return { ok: false, mensaje: error.message }
  return { ok: true }
}
