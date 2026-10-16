import { anclaDeFila, type Ancla } from './ancla'

/**
 * De quién es un cobro, para documentarlo (factura electrónica): el ORIGEN comercial que decide si se
 * factura solo, el contrato que lo respalda y el COMPRADOR con sus datos fiscales. Un cobro cuelga de
 * un negocio (empresa del directorio) o de una suscripción (la empresa que declaró, sin directorio).
 *
 *   - negocio → `negocios.metadata.origen`, el contrato por `negocio_id` y la fila de `empresas`;
 *   - suscripción → `suscripciones_producto.metadata.origen`, el contrato por `suscripcion_id` y la
 *     empresa declarada en la suscripción (NIT con su DV; lo fiscal del RUT leído en `datos_fiscales`).
 *
 * La forma del comprador es la de `EmpresaCompradora` de la factura electrónica (Aliaddo), para que el
 * emisor no sepa de dónde salió. Sin `server-only`: recibe el cliente, no toca secretos.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface CompradorDelCobro {
  razon_social: string | null
  nombre: string | null
  tipo_documento: string | null
  /** Con DV si se conoce (`900123456-7`): la factura lo verifica. */
  numero_documento: string | null
  tipo_persona: string | null
  regimen_tributario: string | null
  responsable_iva: boolean | null
  gran_contribuyente: boolean | null
  autorretenedor: boolean | null
  agente_retenedor: boolean | null
  telefono?: string | null
}

export interface ContratoDelCobro {
  ancla: Ancla | null
  /** La marca comercial del negocio o de la suscripción (p. ej. `valida_autogestion`). */
  origen: string | null
  /** Cuántos contratos tiene el ancla. Más de uno es ambiguo: no se adivina a quién facturar. */
  contratos: number
  contrato: { servicio_slug: string; correo_facturacion: string | null } | null
  comprador: CompradorDelCobro | null
}

const COLUMNAS_EMPRESA =
  'razon_social, nombre, tipo_documento, numero_documento, tipo_persona, regimen_tributario, responsable_iva, gran_contribuyente, autorretenedor, agente_retenedor, telefono'

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** El comprador de una suscripción: lo declarado, con lo fiscal del RUT si se leyó. */
export function compradorDeSuscripcion(s: {
  razon_social: string
  tipo_documento: string | null
  numero_documento: string
  dv: string | null
  datos_fiscales: Record<string, unknown> | null
}): CompradorDelCobro {
  const f = s.datos_fiscales ?? {}
  return {
    razon_social: s.razon_social,
    nombre: s.razon_social,
    tipo_documento: s.tipo_documento ?? 'NIT',
    numero_documento: s.dv ? `${s.numero_documento}-${s.dv}` : s.numero_documento,
    tipo_persona: texto(f.tipo_persona),
    regimen_tributario: texto(f.regimen_tributario),
    responsable_iva: bool(f.responsable_iva),
    gran_contribuyente: bool(f.gran_contribuyente),
    autorretenedor: bool(f.autorretenedor),
    agente_retenedor: bool(f.agente_retenedor),
    telefono: texto(f.telefono),
  }
}

export async function contratoDelCobro(
  db: unknown,
  cobro: { workspace_id: string; negocio_id: string | null; suscripcion_id?: string | null },
): Promise<ContratoDelCobro> {
  const d = db as Db
  const ancla = anclaDeFila(cobro)
  const vacio: ContratoDelCobro = { ancla, origen: null, contratos: 0, contrato: null, comprador: null }
  if (!ancla) return vacio

  if (ancla.tipo === 'negocio') {
    const [n, sc] = await Promise.all([
      d.from('negocios').select('metadata').eq('id', ancla.id).maybeSingle(),
      d
        .from('servicios_contratados')
        .select('empresa_id, correo_facturacion, servicio_slug')
        .eq('negocio_id', ancla.id)
        .eq('workspace_id', cobro.workspace_id)
        .limit(2),
    ])
    if (n.error) throw new Error(`leer negocio: ${n.error.message}`)
    if (sc.error) throw new Error(`leer contrato: ${sc.error.message}`)
    const meta = (n.data?.metadata ?? null) as { origen?: unknown } | null
    const filas = (sc.data ?? []) as { empresa_id: string | null; correo_facturacion: string | null; servicio_slug: string }[]
    const r: ContratoDelCobro = { ancla, origen: texto(meta?.origen), contratos: filas.length, contrato: null, comprador: null }
    if (filas.length !== 1) return r
    r.contrato = { servicio_slug: filas[0].servicio_slug, correo_facturacion: filas[0].correo_facturacion }
    if (filas[0].empresa_id) {
      const em = await d.from('empresas').select(COLUMNAS_EMPRESA).eq('id', filas[0].empresa_id).maybeSingle()
      if (em.error) throw new Error(`leer empresa: ${em.error.message}`)
      r.comprador = (em.data as CompradorDelCobro | null) ?? null
    }
    return r
  }

  const [s, sc] = await Promise.all([
    d
      .from('suscripciones_producto')
      .select('metadata, razon_social, tipo_documento, numero_documento, dv, correo_facturacion, datos_fiscales')
      .eq('id', ancla.id)
      .eq('workspace_id', cobro.workspace_id)
      .maybeSingle(),
    d
      .from('servicios_contratados')
      .select('correo_facturacion, servicio_slug')
      .eq('suscripcion_id', ancla.id)
      .eq('workspace_id', cobro.workspace_id)
      .limit(2),
  ])
  if (s.error) throw new Error(`leer suscripción: ${s.error.message}`)
  if (sc.error) throw new Error(`leer contrato: ${sc.error.message}`)
  const fila = s.data as {
    metadata: { origen?: unknown } | null
    razon_social: string
    tipo_documento: string | null
    numero_documento: string
    dv: string | null
    correo_facturacion: string | null
    datos_fiscales: Record<string, unknown> | null
  } | null
  const filas = (sc.data ?? []) as { correo_facturacion: string | null; servicio_slug: string }[]
  if (!fila) return { ...vacio, contratos: filas.length }
  return {
    ancla,
    origen: texto(fila.metadata?.origen),
    contratos: filas.length,
    contrato:
      filas.length === 1
        ? { servicio_slug: filas[0].servicio_slug, correo_facturacion: filas[0].correo_facturacion ?? fila.correo_facturacion }
        : null,
    comprador: filas.length === 1 ? compradorDeSuscripcion(fila) : null,
  }
}

/**
 * Los negocios y las suscripciones de un cobrador con alguno de esos orígenes (el barrido de la factura
 * electrónica busca sus cobros pagados sin factura).
 */
export async function anclasDeOrigenes(
  db: unknown,
  p: { workspaceId: string; origenes: readonly string[]; limite?: number },
): Promise<{ negocios: string[]; suscripciones: string[] }> {
  const d = db as Db
  const limite = p.limite ?? 1000
  const [n, s] = await Promise.all([
    d.from('negocios').select('id').eq('workspace_id', p.workspaceId).in('metadata->>origen', [...p.origenes]).limit(limite),
    d.from('suscripciones_producto').select('id').eq('workspace_id', p.workspaceId).in('metadata->>origen', [...p.origenes]).limit(limite),
  ])
  if (n.error) throw new Error(`orígenes, negocios: ${n.error.message}`)
  if (s.error) throw new Error(`orígenes, suscripciones: ${s.error.message}`)
  return {
    negocios: ((n.data ?? []) as { id: string }[]).map((x) => x.id),
    suscripciones: ((s.data ?? []) as { id: string }[]).map((x) => x.id),
  }
}
