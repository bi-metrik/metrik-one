import 'server-only'
import { cache } from 'react'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { esFuncionAusente, mapearDocumentos } from './mapeo'
import type { DocumentoContractual } from './resultados'
import type { VersionContratada } from './terminos'

/**
 * Lecturas de servidor de los términos del contrato. Las reglas viven en `terminos.ts`; aquí solo
 * se traen los datos, y cada lectura dice si falló en vez de devolver una lista vacía (un `?? []`
 * convertiría «no pude leer» en «no hay términos», y eso abriría el módulo).
 */

export type LecturaDocumentos =
  | { ok: true; documentos: DocumentoContractual[] }
  | { ok: false; motivo: 'sin_migracion' | 'base' }

async function leerDocumentos(): Promise<LecturaDocumentos> {
  // Cliente de SESIÓN: la RPC deriva el espacio de `current_user_workspace_id()`.
  const { supabase } = await getWorkspace()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await (supabase as any).rpc('mis_documentos_de_servicio')
  if (r.error) {
    if (esFuncionAusente(r.error)) return { ok: false, motivo: 'sin_migracion' }
    console.error('[valida-api] mis_documentos_de_servicio:', r.error.message)
    return { ok: false, motivo: 'base' }
  }
  return { ok: true, documentos: mapearDocumentos(r.data ?? []) }
}

/** Una sola lectura por request aunque la pidan la página, la pestaña y la puerta del módulo. */
export const documentosDelCliente = cache(leerDocumentos)

export interface PerfilReal {
  role: string | null
  workspaceId: string | null
  platformAdmin: boolean
}

/** El perfil de la persona que de verdad tiene la sesión (no el de «Ver como»). `null` si falla. */
export async function perfilReal(usuarioId: string): Promise<PerfilReal | null> {
  const { data, error } = await createServiceClient()
    .from('profiles')
    .select('role, workspace_id, platform_admin')
    .eq('id', usuarioId)
    .maybeSingle()
  if (error || !data) {
    if (error) console.error('[valida-api] perfil de quien acepta:', error.message)
    return null
  }
  const fila = data as { role: string | null; workspace_id: string | null; platform_admin: boolean | null }
  return { role: fila.role, workspaceId: fila.workspace_id, platformAdmin: fila.platform_admin === true }
}

export interface DesignacionContrato {
  designadoId: string | null
  designadoNombre: string | null
}

interface FilaContratoDesignado {
  id: string
  estado: string
  vigente_desde: string
  aceptante_designado_id: string | null
}

/**
 * Quién firma los términos por la empresa, según el contrato que cubre al espacio de la sesión: la
 * persona designada (`servicios_contratados.aceptante_designado_id`) y su nombre, para decirle al
 * resto del equipo a quién esperan.
 *
 * El contrato se elige con el MISMO orden que `versionContratada` y que la guarda de la base (el
 * activo primero, luego el de vigencia más reciente), así que la pantalla, el servidor y la base
 * hablan de la misma persona. Límite conocido: si un espacio tuviera contratos de dos empresas con
 * designados distintos, esto toma el primero; hoy ningún espacio tiene dos (medido 2026-09-23).
 *
 * Se lee con el cliente de servicio, ACOTADO al espacio de la sesión (pagador o beneficiario): la
 * tabla es server-only. `'error'` si alguna lectura falla, nunca «sin designado»: esa respuesta
 * dejaría firmar al dueño en un contrato que designó a otra persona.
 */
export async function designacionDelEspacio(workspaceId: string): Promise<DesignacionContrato | 'error'> {
  // `aceptante_designado_id` nace en 20260923220000 y no está en `database.ts`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const campos = 'id, estado, vigente_desde, aceptante_designado_id'

  const [pagados, beneficiario] = await Promise.all([
    svc.from('servicios_contratados').select(campos).eq('workspace_pagador_id', workspaceId),
    svc.from('servicio_contratado_beneficiarios').select('servicio_contratado_id').eq('workspace_id', workspaceId),
  ])
  if (pagados.error || beneficiario.error) {
    console.error('[terminos] contratos del espacio:', pagados.error?.message ?? beneficiario.error?.message)
    return 'error'
  }

  const contratos: FilaContratoDesignado[] = [...((pagados.data ?? []) as FilaContratoDesignado[])]
  const idsBeneficiario = ((beneficiario.data ?? []) as { servicio_contratado_id: string }[])
    .map((b) => b.servicio_contratado_id)
    .filter((id) => !contratos.some((c) => c.id === id))
  if (idsBeneficiario.length > 0) {
    const cubiertos = await svc.from('servicios_contratados').select(campos).in('id', idsBeneficiario)
    if (cubiertos.error) {
      console.error('[terminos] contratos como beneficiario:', cubiertos.error.message)
      return 'error'
    }
    contratos.push(...((cubiertos.data ?? []) as FilaContratoDesignado[]))
  }

  contratos.sort(
    (a, b) =>
      Number(b.estado === 'activo') - Number(a.estado === 'activo') || b.vigente_desde.localeCompare(a.vigente_desde),
  )
  const designadoId = contratos[0]?.aceptante_designado_id ?? null
  if (!designadoId) return { designadoId: null, designadoNombre: null }

  const perfil = await svc.from('profiles').select('full_name').eq('id', designadoId).maybeSingle()
  if (perfil.error) {
    console.error('[terminos] nombre de la persona designada:', perfil.error.message)
    return 'error'
  }
  const nombre = ((perfil.data as { full_name: string | null } | null)?.full_name ?? '').trim()
  return { designadoId, designadoNombre: nombre || null }
}

interface FilaVersion {
  id: string
  workspace_id: string
  alcance: string
  empresa_id: string | null
  modulo: string | null
  titulo: string
  version: string
  texto_sha256: string
  pdf_sha256: string
}

interface FilaContrato {
  id: string
  negocio_id: string
  estado: string
  vigente_desde: string
  empresa_id: string
  servicio_slug: string
}

const CAMPOS_CONTRATO = 'id, negocio_id, estado, vigente_desde, empresa_id, servicio_slug'

/**
 * La versión con el contrato del cliente que la respalda y los datos de la empresa, leídos con el
 * cliente de servicio y ACOTADOS al espacio de la sesión: el contrato tiene que tener a ese espacio
 * como pagador o como beneficiario, el mismo criterio de `mis_documentos_de_servicio`.
 *
 * ## Qué contrato respalda al documento, según su alcance
 *
 * - `cliente` (los términos de 4D SOFT y de los CDA, que llevan los datos de la empresa): un
 *   contrato de ESA empresa. Es lo que hubo desde C2.
 * - `plantilla` (los términos del Radar SECOP, genéricos y sin empresa): un contrato de un servicio
 *   del MÓDULO que el documento declara (`documentos_contractuales_versiones.modulo` contra
 *   `catalogo_servicios.modulo`, migración `20260929030000`). La empresa que firma sale del
 *   contrato, no del documento: un genérico no nombra a nadie, y la declaración sí tiene que
 *   nombrar a quién obliga.
 *
 * En los dos casos, con varios contratos gana el activo más reciente, el mismo orden que usa la
 * guarda de la base. Sin contrato que lo respalde, `null`: ese documento no es de este espacio.
 */
export async function versionContratada(
  workspaceId: string,
  documentoId: string,
): Promise<VersionContratada | null | 'error'> {
  // Las tablas nacen en la migración de C2 y no están en `database.ts`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any

  const version = await svc
    .from('documentos_contractuales_versiones')
    .select('id, workspace_id, alcance, empresa_id, modulo, titulo, version, texto_sha256, pdf_sha256')
    .eq('id', documentoId)
    .maybeSingle()
  if (version.error) {
    console.error('[valida-api] versión de documento:', version.error.message)
    return 'error'
  }
  const v = version.data as FilaVersion | null
  if (!v) return null
  // El CHECK `documentos_versiones_empresa_coherente` y `documentos_versiones_modulo_coherente` ya
  // exigen esta correspondencia; si faltara el dato, el documento no se puede atar a nada.
  if (v.alcance === 'cliente' && !v.empresa_id) return null
  if (v.alcance === 'plantilla' && !v.modulo) return null
  if (v.alcance !== 'cliente' && v.alcance !== 'plantilla') return null

  // Los servicios del catálogo que encienden el módulo del documento genérico. Sin ninguno, nadie
  // puede tenerlo contratado.
  let slugsDelModulo: string[] = []
  if (v.alcance === 'plantilla') {
    const servicios = await svc.from('catalogo_servicios').select('slug').eq('modulo', v.modulo)
    if (servicios.error) {
      console.error('[valida-api] servicios del módulo del documento:', servicios.error.message)
      return 'error'
    }
    slugsDelModulo = ((servicios.data ?? []) as { slug: string }[]).map((s) => s.slug)
    if (slugsDelModulo.length === 0) return null
  }

  /** Los contratos del cobrador que corresponden al documento, sin decidir todavía quién los cubre. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delDocumento = (q: any) =>
    v.alcance === 'cliente' ? q.eq('empresa_id', v.empresa_id) : q.in('servicio_slug', slugsDelModulo)

  const [pagados, beneficiario] = await Promise.all([
    delDocumento(
      svc.from('servicios_contratados').select(CAMPOS_CONTRATO).eq('workspace_id', v.workspace_id),
    ).eq('workspace_pagador_id', workspaceId),
    svc.from('servicio_contratado_beneficiarios').select('servicio_contratado_id').eq('workspace_id', workspaceId),
  ])
  if (pagados.error || beneficiario.error) {
    console.error(
      '[valida-api] contrato del documento:',
      pagados.error?.message ?? beneficiario.error?.message,
    )
    return 'error'
  }

  const contratos: FilaContrato[] = [...((pagados.data ?? []) as FilaContrato[])]
  const idsBeneficiario = ((beneficiario.data ?? []) as { servicio_contratado_id: string }[]).map(
    (b) => b.servicio_contratado_id,
  )
  if (idsBeneficiario.length > 0) {
    const cubiertos = await delDocumento(
      svc.from('servicios_contratados').select(CAMPOS_CONTRATO).eq('workspace_id', v.workspace_id),
    ).in('id', idsBeneficiario)
    if (cubiertos.error) {
      console.error('[valida-api] contratos como beneficiario:', cubiertos.error.message)
      return 'error'
    }
    for (const c of (cubiertos.data ?? []) as FilaContrato[]) {
      if (!contratos.some((x) => x.id === c.id)) contratos.push(c)
    }
  }
  if (contratos.length === 0) return null

  contratos.sort(
    (a, b) =>
      Number(b.estado === 'activo') - Number(a.estado === 'activo') || b.vigente_desde.localeCompare(a.vigente_desde),
  )

  // La empresa que firma es la del contrato elegido. En un documento 'cliente' es la misma que el
  // documento nombra (el filtro de arriba lo garantiza); en un 'plantilla' es la única que hay.
  const empresaId = contratos[0].empresa_id
  const empresa = await svc
    .from('empresas')
    .select('nombre, razon_social, numero_documento')
    .eq('id', empresaId)
    .maybeSingle()
  if (empresa.error) {
    console.error('[valida-api] empresa del contrato:', empresa.error.message)
    return 'error'
  }

  const e = empresa.data as { nombre: string | null; razon_social: string | null; numero_documento: string | null } | null
  const empresaNombre = (e?.razon_social || e?.nombre || '').trim()
  const empresaNit = (e?.numero_documento || '').trim()
  if (!empresaNombre || !empresaNit) {
    console.error('[valida-api] la empresa del contrato no tiene razón social o NIT:', empresaId)
    return null
  }

  return {
    documentoId: v.id,
    workspaceCobradorId: v.workspace_id,
    titulo: v.titulo,
    version: v.version,
    textoSha256: v.texto_sha256,
    pdfSha256: v.pdf_sha256,
    empresaNombre,
    empresaNit,
    negocioId: contratos[0].negocio_id,
  }
}
