import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type {
  CertPublica,
  CertLoteRow,
  CertProductoRow,
  CertDocumentoRow,
  CertConfig,
} from './types'

// Cliente service-role SIN tipado de Database (las tablas cert_* aun no estan en
// database.ts). Aislado a este modulo. Bypassa RLS: por eso TODA lectura publica
// pasa por aqui y filtra explicitamente estado='publicado' + flag del workspace.
function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const SHORT_CODE_RE = /^[A-Z0-9]{6,12}$/

/** Resuelve un codigo corto (QR) al id del lote. Null si no existe / formato invalido. */
export async function getCertIdByShortCode(code: string): Promise<string | null> {
  if (!SHORT_CODE_RE.test(code)) return null
  const { data } = await serviceClient()
    .from('cert_lotes')
    .select('id')
    .eq('short_code', code)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/**
 * Lee la certificacion publica de un lote. Unico punto de acceso publico.
 * Devuelve null si: id invalido, lote inexistente, no publicado, o el workspace
 * no tiene el modulo cert_qr activo. Un lote vencido SI se devuelve (la pagina
 * muestra el estado "vencida" + recertificacion); solo se oculta lo no publicado.
 */
export async function getCertPublica(loteId: string): Promise<CertPublica | null> {
  if (!UUID_RE.test(loteId)) return null
  const db = serviceClient()

  const { data: loteData } = await db
    .from('cert_lotes')
    .select('*')
    .eq('id', loteId)
    .eq('estado', 'publicado')
    .maybeSingle()
  if (!loteData) return null
  const lote = loteData as CertLoteRow

  // El workspace debe tener el modulo activo (defensa por si se desactiva)
  const { data: ws } = await db
    .from('workspaces')
    .select('modules, name, config_extra')
    .eq('id', lote.workspace_id)
    .maybeSingle()
  const modules = (ws?.modules ?? {}) as Record<string, boolean>
  if (!modules.cert_qr) return null

  const certCfg = ((ws?.config_extra as Record<string, unknown> | null)?.cert ?? {}) as CertConfig

  let producto: CertProductoRow | null = null
  if (lote.cert_producto_id) {
    const { data } = await db
      .from('cert_productos')
      .select('*')
      .eq('id', lote.cert_producto_id)
      .maybeSingle()
    producto = (data as CertProductoRow) ?? null
  }

  const { data: docs } = await db
    .from('cert_documentos')
    .select('tipo, nombre, public_url')
    .eq('cert_lote_id', loteId)
  const documentos = (docs as CertDocumentoRow[]) ?? []

  // Codigo del negocio (proyecto) en el ws — para la trazabilidad del certificado
  let negocioCodigo: string | null = null
  if (lote.negocio_id) {
    const { data: neg } = await db
      .from('negocios')
      .select('codigo')
      .eq('id', lote.negocio_id)
      .maybeSingle()
    negocioCodigo = (neg?.codigo as string | undefined) ?? null
  }

  const hoyMs = new Date().setHours(0, 0, 0, 0)
  let vigente = false
  let diasParaVencer: number | null = null
  if (lote.fecha_vencimiento) {
    const vencMs = new Date(lote.fecha_vencimiento + 'T00:00:00').getTime()
    vigente = vencMs >= hoyMs
    diasParaVencer = Math.round((vencMs - hoyMs) / 86_400_000)
  }

  return {
    lote,
    producto,
    documentos,
    vigente,
    diasParaVencer,
    workspaceNombre: (ws?.name as string | undefined) ?? null,
    negocioCodigo,
    databookDisponible: !!producto?.databook_path,
    fabricante: certCfg.fabricante ?? null,
    ingeniero: certCfg.ingeniero ?? null,
  }
}
