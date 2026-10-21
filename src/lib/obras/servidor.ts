import 'server-only'

/**
 * Lecturas de las obras con el cliente de SESIÓN (RLS del propio workspace). Nunca lanzan: si la
 * migración no está aplicada devuelven `sin_migracion` y la pantalla lo dice, sin romper la ficha.
 *
 * Toda cifra derivada sale de las vistas (`v_cierre_obra`, `v_facturas_obra`, `v_jornadas_dia`).
 */
import { COLUMNAS_CIERRE, resumirCierre, type FilaCierreObra, type ResumenCierre } from './cierre'
import { COLUMNAS_FACTURA_OBRA, normalizarFacturaObra, type FacturaObra } from './facturas'
import { COLUMNAS_JORNADA, normalizarJornada, type JornadaDia } from './llegadas'
import { faltaMigracionObras } from './modulo'
import type { CondicionesObra } from './condiciones'
import type { TipoColaborador } from './colaboradores'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

export interface FacturaDeLaObra extends FacturaObra {
  soporte_url: string | null
}

export interface CobroDeLaObra {
  id: string
  fecha: string | null
  monto: number
  factura_id: string | null
  numero_transaccion: string | null
  tipo_cobro: string | null
}

export interface ColaboradorParaLlegada {
  id: string
  name: string
  tipo: TipoColaborador
}

export interface ObraParaLlegada {
  id: string
  codigo: string | null
  nombre: string
}

export type PanelObra =
  | { estado: 'sin_migracion' }
  | { estado: 'error' }
  | {
      estado: 'ok'
      condiciones: CondicionesObra
      cierre: ResumenCierre | null
      facturas: FacturaDeLaObra[]
      cobros: CobroDeLaObra[]
      jornadas: JornadaDia[]
      colaboradores: ColaboradorParaLlegada[]
      /** Obras abiertas del workspace: para mover una llegada a la obra correcta. */
      obras: ObraParaLlegada[]
    }

function fallo(contexto: string, e: { code?: string; message?: string } | null): 'sin_migracion' | 'error' {
  if (faltaMigracionObras(e)) return 'sin_migracion'
  console.warn(`[obras] ${contexto}:`, e?.code ?? '', e?.message ?? '')
  return 'error'
}

/** Todo lo que la sección de obra de la ficha del negocio necesita, en paralelo. */
export async function leerPanelObra(supabase: unknown, workspaceId: string, negocioId: string): Promise<PanelObra> {
  const db = supabase as Cliente
  try {
    const [neg, cierre, facturas, soportes, cobros, jornadas, colaboradores, obras] = await Promise.all([
      db
        .from('negocios')
        .select('nombre_corto, anticipo_pct, forma_pago, plazo_pago_dias')
        .eq('workspace_id', workspaceId)
        .eq('id', negocioId)
        .maybeSingle(),
      db.from('v_cierre_obra').select(COLUMNAS_CIERRE).eq('workspace_id', workspaceId).eq('negocio_id', negocioId).maybeSingle(),
      db
        .from('v_facturas_obra')
        .select(COLUMNAS_FACTURA_OBRA)
        .eq('workspace_id', workspaceId)
        .eq('negocio_id', negocioId)
        .order('fecha_emision', { ascending: true }),
      db.from('facturas').select('id, soporte_url').eq('workspace_id', workspaceId).eq('negocio_id', negocioId),
      // Lo cobrado de verdad: sin anulados y con fecha (sin fecha es una cuota programada).
      db
        .from('cobros')
        .select('id, fecha, monto, factura_id, numero_transaccion, tipo_cobro')
        .eq('workspace_id', workspaceId)
        .eq('negocio_id', negocioId)
        .is('anulado_at', null)
        .not('fecha', 'is', null)
        .order('fecha', { ascending: true }),
      db
        .from('v_jornadas_dia')
        .select(COLUMNAS_JORNADA)
        .eq('workspace_id', workspaceId)
        .eq('negocio_id', negocioId)
        .order('fecha', { ascending: false })
        .order('hora', { ascending: true })
        .limit(1000),
      db.from('wa_collaborators').select('id, name, tipo').eq('workspace_id', workspaceId).eq('is_active', true).order('name'),
      db.from('negocios').select('id, codigo, nombre').eq('workspace_id', workspaceId).eq('estado', 'abierto').order('nombre').limit(300),
    ])
    for (const [nombre, r] of [
      ['negocio', neg],
      ['cierre', cierre],
      ['facturas', facturas],
      ['soportes', soportes],
      ['cobros', cobros],
      ['jornadas', jornadas],
      ['colaboradores', colaboradores],
      ['obras', obras],
    ] as const) {
      if (r.error) return { estado: fallo(`no se pudo leer ${nombre}`, r.error) }
    }

    const soporteDe = new Map<string, string | null>(
      ((soportes.data ?? []) as { id: string; soporte_url: string | null }[]).map((f) => [f.id, f.soporte_url]),
    )
    const n = (neg.data ?? {}) as Partial<CondicionesObra>
    return {
      estado: 'ok',
      condiciones: {
        nombre_corto: n.nombre_corto ?? null,
        anticipo_pct: n.anticipo_pct === null || n.anticipo_pct === undefined ? null : Number(n.anticipo_pct),
        forma_pago: n.forma_pago ?? null,
        plazo_pago_dias: n.plazo_pago_dias === null || n.plazo_pago_dias === undefined ? null : Number(n.plazo_pago_dias),
      },
      cierre: cierre.data ? resumirCierre(cierre.data as FilaCierreObra) : null,
      facturas: ((facturas.data ?? []) as Record<string, unknown>[]).map((f) => {
        const fac = normalizarFacturaObra(f)
        return { ...fac, soporte_url: soporteDe.get(fac.id) ?? null }
      }),
      cobros: ((cobros.data ?? []) as Record<string, unknown>[]).map((c) => ({
        id: String(c.id),
        fecha: (c.fecha as string | null) ?? null,
        monto: Number(c.monto ?? 0),
        factura_id: (c.factura_id as string | null) ?? null,
        numero_transaccion: (c.numero_transaccion as string | null) ?? null,
        tipo_cobro: (c.tipo_cobro as string | null) ?? null,
      })),
      jornadas: ((jornadas.data ?? []) as Record<string, unknown>[]).map(normalizarJornada),
      colaboradores: ((colaboradores.data ?? []) as { id: string; name: string; tipo: string | null }[]).map((c) => ({
        id: c.id,
        name: c.name,
        tipo: c.tipo === 'operario' ? 'operario' : 'equipo',
      })),
      obras: ((obras.data ?? []) as { id: string; codigo: string | null; nombre: string | null }[]).map((o) => ({
        id: o.id,
        codigo: o.codigo,
        nombre: o.nombre ?? 'Sin nombre',
      })),
    }
  } catch (e) {
    console.warn('[obras] no se pudo leer el panel de la obra:', e instanceof Error ? e.message : e)
    return { estado: 'error' }
  }
}

export interface ObraDelResumen {
  negocio_id: string
  codigo: string | null
  nombre: string
  cliente: string
  cierre: ResumenCierre
}

export type ResumenObras =
  | { estado: 'sin_migracion' }
  | { estado: 'error' }
  | {
      estado: 'ok'
      abiertas: ObraDelResumen[]
      cerradas: ObraDelResumen[]
      facturas: FacturaObra[]
      nombreDeEmpresa: Record<string, string>
    }

/** La pantalla `/obras`: el cierre de cada obra y las facturas (para lo retenido por cliente). */
export async function leerResumenObras(supabase: unknown, workspaceId: string): Promise<ResumenObras> {
  const db = supabase as Cliente
  try {
    const [cierres, facturas] = await Promise.all([
      db.from('v_cierre_obra').select(COLUMNAS_CIERRE).eq('workspace_id', workspaceId).order('codigo').limit(1000),
      db.from('v_facturas_obra').select(COLUMNAS_FACTURA_OBRA).eq('workspace_id', workspaceId).limit(5000),
    ])
    if (cierres.error) return { estado: fallo('no se pudo leer el cierre de las obras', cierres.error) }
    if (facturas.error) return { estado: fallo('no se pudieron leer las facturas de las obras', facturas.error) }
    const filas = (cierres.data ?? []) as FilaCierreObra[]
    const facs = ((facturas.data ?? []) as Record<string, unknown>[]).map(normalizarFacturaObra)

    const empresaIds = [...new Set([...filas.map((f) => f.empresa_id), ...facs.map((f) => f.empresa_id)].filter((x): x is string => !!x))]
    const nombreDeEmpresa: Record<string, string> = {}
    // De a 100: un `.in()` con cientos de uuid revienta la cabecera (gotcha de /negocios).
    for (let i = 0; i < empresaIds.length; i += 100) {
      const { data, error } = await db.from('empresas').select('id, nombre').eq('workspace_id', workspaceId).in('id', empresaIds.slice(i, i + 100))
      if (error) return { estado: fallo('no se pudieron leer los clientes', error) }
      for (const e of (data ?? []) as { id: string; nombre: string | null }[]) nombreDeEmpresa[e.id] = e.nombre ?? 'Sin nombre'
    }

    const obras: ObraDelResumen[] = filas
      .filter((f) => !!f.negocio_id)
      .map((f) => ({
        negocio_id: f.negocio_id as string,
        codigo: f.codigo,
        nombre: f.nombre ?? 'Sin nombre',
        cliente: f.empresa_id ? (nombreDeEmpresa[f.empresa_id] ?? 'Sin cliente') : 'Sin cliente',
        cierre: resumirCierre(f),
      }))
    return {
      estado: 'ok',
      abiertas: obras.filter((o) => !o.cierre.cerrada),
      cerradas: obras.filter((o) => o.cierre.cerrada),
      facturas: facs,
      nombreDeEmpresa,
    }
  } catch (e) {
    console.warn('[obras] no se pudo leer el resumen de obras:', e instanceof Error ? e.message : e)
    return { estado: 'error' }
  }
}
