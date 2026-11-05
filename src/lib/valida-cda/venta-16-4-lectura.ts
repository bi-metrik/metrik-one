import 'server-only'
import { esVersionCdaDesde, SLUG_TERMINOS_CDA } from './plazos'
import { datosDelTextoV15 } from './terminos-v1-5'
import { diaBogota, VENTA_SIN_V15, type VentaV15 } from './venta-16-4'

/**
 * La venta de la v1.5 de un contrato CDA leída con el cliente de SERVICIO (cron, enlace, reactivación): la
 * misma respuesta que `ventaDeDocumentos` da en la sesión del cliente (`mis_documentos_de_servicio`).
 *
 *   - la v1.5 (o posterior) registrada para la empresa del contrato, publicada a `ahoraISO`, la de vigencia
 *     más reciente; su base es la fecha de la 16.4 del TEXTO registrado (`datosDelTextoV15`);
 *   - la aceptación: `aceptaciones_terminos` con la huella de ESE PDF, `aceptado` y del negocio del
 *     contrato (el mismo cruce de la RPC).
 *
 * `{ error }` si alguna lectura falla: quien llama decide, y nunca lo lee como «no aceptada».
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export async function ventaV15DelContrato(
  db: Db,
  sc: { empresa_id: string | null; negocio_id: string | null },
  ahoraISO: string = new Date().toISOString(),
): Promise<VentaV15 | { error: string }> {
  if (!sc.empresa_id) return VENTA_SIN_V15
  const r = await db
    .from('documentos_contractuales_versiones')
    .select('slug, version, vigente_desde, rige_por_aviso, publicada_at, texto_md, pdf_sha256')
    .eq('empresa_id', sc.empresa_id)
    .eq('slug', SLUG_TERMINOS_CDA)
  if (r.error) return { error: `documentos de la v1.5: ${r.error.message}` }
  const ahora = Date.parse(ahoraISO)
  type Fila = {
    slug: string
    version: string
    vigente_desde: string | null
    rige_por_aviso: boolean | null
    publicada_at: string | null
    texto_md: string | null
    pdf_sha256: string | null
  }
  const v15 = ((r.data ?? []) as Fila[])
    .filter(
      (d) =>
        d.vigente_desde &&
        d.rige_por_aviso === true &&
        d.publicada_at !== null &&
        Date.parse(d.publicada_at) <= ahora &&
        esVersionCdaDesde(d, [1, 5]),
    )
    .sort((a, b) => String(b.vigente_desde).localeCompare(String(a.vigente_desde)))[0]
  if (!v15) return VENTA_SIN_V15
  const base = datosDelTextoV15(v15.texto_md ?? '').exigeDesde
  if (!v15.pdf_sha256 || !sc.negocio_id) return { base, aceptadaEl: null }
  const a = await db
    .from('aceptaciones_terminos')
    .select('created_at')
    .eq('documento_sha256', v15.pdf_sha256)
    .eq('estado', 'aceptado')
    .eq('negocio_id', sc.negocio_id)
  if (a.error) return { error: `aceptación de la v1.5: ${a.error.message}` }
  const dias = ((a.data ?? []) as { created_at: string | null }[])
    .map((x) => diaBogota(x.created_at))
    .filter((x): x is string => x !== null)
    .sort()
  return { base, aceptadaEl: dias[0] ?? null }
}
