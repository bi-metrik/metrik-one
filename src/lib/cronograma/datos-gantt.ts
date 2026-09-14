import 'server-only'
import type { PasoParaGantt } from './gantt'
import type { PasoPlan } from './versionado'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface EncabezadoGantt {
  empresaEmisora: string
  nitEmisor: string | null
  logoUrl: string | null
  colorPrimario: string | null
  negocioCodigo: string | null
  negocioNombre: string
  cliente: string | null
}

export interface VersionGantt {
  numero: number
  publicada: string
  cambios: string[]
}

export interface DatosGantt {
  encabezado: EncabezadoGantt
  version: VersionGantt | null
  pasos: PasoParaGantt[]
}

interface FilaItem {
  id: string
  orden: number | null
  label: string | null
  fecha_inicio: string | null
  fecha_fin: string | null
  fecha_inicio_real: string | null
  fecha_fin_real: string | null
  responsable_id: string | null
  completado: boolean | null
}

/**
 * Junta lo que pinta el Gantt: la marca de quien emite, el negocio, la última versión
 * publicada y el avance real de cada paso.
 *
 * El PLAN sale del snapshot de la versión, no del paso vivo. Hoy coinciden, porque todo
 * cambio de planeación corta versión, pero el documento dice «Versión N» y tiene que
 * mostrar lo que esa versión congeló aunque mañana eso deje de ser cierto. Sin versión
 * todavía (cronogramas anteriores al versionado), el plan vivo hace de borrador.
 *
 * No verifica permisos: quien la llama ya pasó el guard del negocio.
 */
export async function leerDatosGantt(
  supabase: Db,
  opciones: { negocioBloqueId: string; negocioId: string; workspaceId: string },
): Promise<DatosGantt | null> {
  const { negocioBloqueId, negocioId, workspaceId } = opciones

  const [negocioRes, wsRes, fiscalRes, itemsRes, versionRes, perfilesRes] = await Promise.all([
    supabase.from('negocios').select('codigo, nombre, empresas(nombre)').eq('id', negocioId).maybeSingle(),
    supabase.from('workspaces').select('name, logo_url, color_primario').eq('id', workspaceId).maybeSingle(),
    supabase.from('fiscal_profiles').select('razon_social, nit').eq('workspace_id', workspaceId).maybeSingle(),
    supabase
      .from('bloque_items')
      .select('id, orden, label, fecha_inicio, fecha_fin, fecha_inicio_real, fecha_fin_real, responsable_id, completado')
      .eq('negocio_bloque_id', negocioBloqueId)
      .order('orden', { ascending: true }),
    supabase
      .from('cronograma_versiones')
      .select('numero, created_at, snapshot, cambios')
      .eq('negocio_bloque_id', negocioBloqueId)
      .order('numero', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('profiles').select('id, full_name').eq('workspace_id', workspaceId),
  ])

  const negocio = negocioRes.data as { codigo: string | null; nombre: string; empresas: { nombre: string | null } | null } | null
  if (!negocio) return null
  // Un error leyendo los pasos no puede pintarse como «cronograma vacío»: el cliente
  // recibiría un documento que dice que no hay nada que hacer.
  if (itemsRes.error) return null

  const ws = wsRes.data as { name: string | null; logo_url: string | null; color_primario: string | null } | null
  const fiscal = fiscalRes.data as { razon_social: string | null; nit: string | null } | null
  const items = (itemsRes.data ?? []) as FilaItem[]
  const nombres = new Map<string, string>()
  for (const p of (perfilesRes.data ?? []) as { id: string; full_name: string | null }[]) {
    if (p.full_name) nombres.set(p.id, p.full_name)
  }

  const filaVersion = versionRes.data as { numero: number; created_at: string; snapshot: unknown; cambios: unknown } | null
  const snapshot = filaVersion && Array.isArray(filaVersion.snapshot) ? (filaVersion.snapshot as PasoPlan[]) : null

  const vivos = new Map(items.map(i => [i.id, i]))
  const aPaso = (plan: Pick<PasoPlan, 'id' | 'label' | 'fecha_inicio' | 'fecha_fin' | 'responsable_id'>): PasoParaGantt => {
    const vivo = vivos.get(plan.id)
    return {
      id: plan.id,
      label: plan.label ?? '',
      responsable: plan.responsable_id ? nombres.get(plan.responsable_id) ?? null : null,
      plan_inicio: plan.fecha_inicio,
      plan_fin: plan.fecha_fin,
      real_inicio: vivo?.fecha_inicio_real ?? null,
      real_fin: vivo?.fecha_fin_real ?? null,
      completado: vivo?.completado === true,
    }
  }

  let pasos: PasoParaGantt[]
  if (snapshot) {
    pasos = snapshot.map(aPaso)
    // Un paso vivo que la versión no tiene no se esconde: se muestra sin plan.
    const enVersion = new Set(snapshot.map(p => p.id))
    for (const i of items) {
      if (!enVersion.has(i.id)) {
        pasos.push({ ...aPaso({ id: i.id, label: i.label ?? '', fecha_inicio: null, fecha_fin: null, responsable_id: i.responsable_id }) })
      }
    }
  } else {
    pasos = items.map(i => aPaso({ id: i.id, label: i.label ?? '', fecha_inicio: i.fecha_inicio, fecha_fin: i.fecha_fin, responsable_id: i.responsable_id }))
  }

  return {
    encabezado: {
      empresaEmisora: fiscal?.razon_social?.trim() || ws?.name?.trim() || 'Empresa',
      nitEmisor: fiscal?.nit ?? null,
      logoUrl: ws?.logo_url ?? null,
      colorPrimario: ws?.color_primario ?? null,
      negocioCodigo: negocio.codigo,
      negocioNombre: negocio.nombre,
      cliente: negocio.empresas?.nombre ?? null,
    },
    version: filaVersion
      ? {
          numero: filaVersion.numero,
          publicada: filaVersion.created_at,
          cambios: Array.isArray(filaVersion.cambios) ? (filaVersion.cambios as string[]) : [],
        }
      : null,
    pasos,
  }
}
