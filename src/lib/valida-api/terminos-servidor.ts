import 'server-only'
import { cache } from 'react'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { createServiceClient } from '@/lib/supabase/server'
import { esFuncionAusente, mapearDocumentos } from './mapeo'
import type { DocumentoContractual } from './resultados'
import { estadoTerminos, type EstadoTerminos, type VersionContratada } from './terminos'

/**
 * Lecturas de servidor de los términos del contrato. Las reglas viven en `terminos.ts`; aquí solo
 * se traen los datos, y cada lectura dice si falló en vez de devolver una lista vacía (un `?? []`
 * convertiría «no pude leer» en «no hay términos», y eso abriría las llaves).
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

/** Una sola lectura por request aunque la pidan la página, la pestaña y la puerta de llaves. */
export const documentosDelCliente = cache(leerDocumentos)

export async function terminosDelCliente(): Promise<EstadoTerminos | { estado: 'no_disponible' }> {
  const lectura = await documentosDelCliente()
  if (!lectura.ok) return { estado: 'no_disponible' }
  return estadoTerminos(lectura.documentos, todayBogotaISO())
}

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

interface FilaVersion {
  id: string
  workspace_id: string
  empresa_id: string | null
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
}

/**
 * La versión con el contrato del cliente que la respalda y los datos de la empresa, leídos con el
 * cliente de servicio y ACOTADOS al espacio de la sesión: el contrato tiene que tener a ese espacio
 * como pagador o como beneficiario, el mismo criterio de `mis_documentos_de_servicio`.
 *
 * Con varios contratos de la misma empresa gana el activo más reciente. La base acepta cualquiera
 * de ellos, porque la constancia se muestra en todos.
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
    .select('id, workspace_id, empresa_id, titulo, version, texto_sha256, pdf_sha256')
    .eq('id', documentoId)
    .maybeSingle()
  if (version.error) {
    console.error('[valida-api] versión de documento:', version.error.message)
    return 'error'
  }
  const v = version.data as FilaVersion | null
  if (!v?.empresa_id) return null

  const [empresa, pagados, beneficiario] = await Promise.all([
    svc.from('empresas').select('nombre, razon_social, numero_documento').eq('id', v.empresa_id).maybeSingle(),
    svc
      .from('servicios_contratados')
      .select('id, negocio_id, estado, vigente_desde')
      .eq('workspace_id', v.workspace_id)
      .eq('empresa_id', v.empresa_id)
      .eq('workspace_pagador_id', workspaceId),
    svc.from('servicio_contratado_beneficiarios').select('servicio_contratado_id').eq('workspace_id', workspaceId),
  ])
  if (empresa.error || pagados.error || beneficiario.error) {
    console.error(
      '[valida-api] contrato del documento:',
      empresa.error?.message ?? pagados.error?.message ?? beneficiario.error?.message,
    )
    return 'error'
  }

  const contratos: FilaContrato[] = [...((pagados.data ?? []) as FilaContrato[])]
  const idsBeneficiario = ((beneficiario.data ?? []) as { servicio_contratado_id: string }[]).map(
    (b) => b.servicio_contratado_id,
  )
  if (idsBeneficiario.length > 0) {
    const cubiertos = await svc
      .from('servicios_contratados')
      .select('id, negocio_id, estado, vigente_desde')
      .eq('workspace_id', v.workspace_id)
      .eq('empresa_id', v.empresa_id)
      .in('id', idsBeneficiario)
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

  const e = empresa.data as { nombre: string | null; razon_social: string | null; numero_documento: string | null } | null
  const empresaNombre = (e?.razon_social || e?.nombre || '').trim()
  const empresaNit = (e?.numero_documento || '').trim()
  if (!empresaNombre || !empresaNit) {
    console.error('[valida-api] la empresa del contrato no tiene razón social o NIT:', v.empresa_id)
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
