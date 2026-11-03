/**
 * Datos de un negocio REAL para la vista previa de una plantilla editable. SOLO LECTURA: no
 * crea filas de bloque, no guarda versiones del formulario, no sube nada a Drive.
 *
 * Resuelve lo mismo que `generarFormularioCore` antes de imprimir: `campos_fuente` del bloque
 * del documento en la línea del negocio, con los overrides del operador encima y las letras
 * dobles convertidas (`datosParaPdf`). Las guardas que DETIENEN la generación (NIT pegado,
 * disputa, confirmación a ciegas) no se corren aquí: la vista previa muestra el texto, y los
 * faltantes se listan para que la persona sepa que ese negocio todavía no se puede generar.
 */
import { resolverCamposFuente, type CampoFuente } from '@/lib/formularios/resolver-campos-fuente'
import { datosParaPdf } from '@/lib/texto/texto-latino'
import type { Datos, TipoPlantilla } from './catalogo'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

export interface NegocioParaVista {
  id: string
  codigo: string | null
  nombre: string
}

interface ConfigDocumento {
  id: string
  config_extra: Record<string, unknown>
  linea_id: string
}

/** Configs de bloque cuyo `template` es este documento, con su línea. */
async function configsDelDocumento(cliente: unknown, workspaceId: string, tipo: TipoPlantilla): Promise<ConfigDocumento[]> {
  const { data } = await db(cliente)
    .from('bloque_configs')
    .select('id, config_extra, etapas_negocio!inner(linea_id)')
    .eq('workspace_id', workspaceId)
    .eq('config_extra->>template', tipo)
  return ((data ?? []) as Array<{ id: string; config_extra: Record<string, unknown> | null; etapas_negocio: { linea_id: string } | null }>)
    .filter((c) => c.etapas_negocio?.linea_id)
    .map((c) => ({ id: c.id, config_extra: c.config_extra ?? {}, linea_id: c.etapas_negocio!.linea_id }))
}

/** La config «dueña» del documento: la que trae `campos_fuente` y no es una copia heredada. */
function configPrincipal(configs: ConfigDocumento[], lineaId: string): ConfigDocumento | null {
  const deLinea = configs.filter((c) => c.linea_id === lineaId)
  const conCampos = deLinea.filter((c) => Array.isArray(c.config_extra.campos_fuente) && (c.config_extra.campos_fuente as unknown[]).length > 0)
  return conCampos.find((c) => !c.config_extra.heredado) ?? conCampos[0] ?? null
}

/** Negocios del workspace cuya línea genera este documento, por código o nombre. */
export async function buscarNegociosConDocumento(
  cliente: unknown,
  workspaceId: string,
  tipo: TipoPlantilla,
  texto: string,
): Promise<NegocioParaVista[]> {
  const configs = await configsDelDocumento(cliente, workspaceId, tipo)
  const lineas = [...new Set(configs.map((c) => c.linea_id))]
  if (lineas.length === 0) return []
  let q = db(cliente)
    .from('negocios')
    .select('id, codigo, nombre')
    .eq('workspace_id', workspaceId)
    .in('linea_id', lineas)
  const limpio = texto.trim().replace(/[%,()*\\]/g, ' ').trim()
  if (limpio) q = q.or(`codigo.ilike.%${limpio}%,nombre.ilike.%${limpio}%`)
  const { data } = await q.order('updated_at', { ascending: false }).limit(15)
  return ((data ?? []) as NegocioParaVista[])
}

export type DatosDeNegocio =
  | { ok: true; datos: Datos; faltantes: string[]; codigo: string }
  | { ok: false; error: string }

export async function datosDelNegocio(
  cliente: unknown,
  workspaceId: string,
  negocioId: string,
  tipo: TipoPlantilla,
): Promise<DatosDeNegocio> {
  const { data: negocio } = await db(cliente)
    .from('negocios')
    .select('id, codigo, linea_id')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!negocio) return { ok: false, error: 'No se encontró ese negocio en tu espacio.' }
  const lineaId = negocio.linea_id as string | null
  if (!lineaId) return { ok: false, error: 'Ese negocio no tiene línea asignada.' }

  const config = configPrincipal(await configsDelDocumento(cliente, workspaceId, tipo), lineaId)
  if (!config) return { ok: false, error: 'La línea de ese negocio no genera este documento.' }

  const camposFuente = (config.config_extra.campos_fuente ?? []) as CampoFuente[]
  const { datos, faltantes } = await resolverCamposFuente(cliente, negocioId, lineaId, camposFuente)

  // Overrides del operador, igual que en la generación (sin crear la fila si no existe).
  const { data: fila } = await db(cliente)
    .from('negocio_bloques')
    .select('data')
    .eq('negocio_id', negocioId)
    .eq('bloque_config_id', config.id)
    .maybeSingle()
  const overrides = ((fila?.data as Record<string, unknown> | null)?.campos_override ?? {}) as Record<string, string | null>
  const constantes = (config.config_extra.campos_constantes ?? {}) as Record<string, string>
  const final: Record<string, string | null> = { ...datos }
  for (const [k, v] of Object.entries(overrides)) if (!(k in constantes)) final[k] = v

  const tiene = (v: string | null | undefined) => v != null && v !== ''
  const faltantesReales = faltantes.filter((f) => !tiene(final[f]))
  const limpios = datosParaPdf(final)
  return {
    ok: true,
    datos: limpios.ok ? limpios.datos : final,
    faltantes: faltantesReales,
    codigo: (negocio.codigo as string | null) ?? negocioId.slice(0, 8),
  }
}
