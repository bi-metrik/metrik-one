'use server'

/**
 * Devolución de dinero desde Tesorería (SOE-007).
 *
 * Una sola acción: guarda negocio, fecha, monto, motivo y soporte opcional, y si la casilla
 * «cerrar el caso» viene marcada, cierra el negocio como perdido EN LA MISMA OPERACIÓN. La
 * escritura entera vive en `registrar_devolucion_dinero` (migración 20261009160000), que
 * bloquea el negocio y valida contra lo recaudado neto: dos devoluciones simultáneas no
 * pueden sumar más de lo que entró, y el cierre no queda a medias si algo falla.
 *
 * PERMISOS: los mismos que registrar, corregir o anular un pago fuera de la pasarela
 * (`ctxPagosExternos` → `puedeGestionarPagosExternos`): área financiera, más owner/admin.
 * La función de la base solo la puede ejecutar `service_role`, así que este guard no se puede
 * saltar llamando la RPC con la sesión.
 *
 * El cobro original NO se toca. Ver `lib/cobros/devolucion-dinero.ts`.
 */

import { revalidatePath } from 'next/cache'
import { accionIdempotente } from '@/lib/idempotencia/accion'
import { MENSAJE_EN_CURSO } from '@/lib/idempotencia/clave'
import { ctxPagosExternos } from '@/lib/permissions/ctx-pagos-externos'
import { createServiceClient } from '@/lib/supabase/server'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { traerTodo } from '@/lib/supabase/paginar'
import {
  BUCKET_DOCUMENTOS_ONE,
  construirReferenciaOne,
  esRutaDeWorkspace,
} from '@/lib/almacenamiento/referencia'
import {
  etiquetaRazonCierre,
  mensajeDeRechazo,
  recaudadoNeto,
  validarDevolucion,
  type EntradaDevolucion,
  type RespuestaRegistro,
} from '@/lib/cobros/devolucion-dinero'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

export interface SoporteDevolucionInput {
  /** Path en `ve-documentos`, subido por el navegador bajo `<workspace_id>/devoluciones/`. */
  storage_path: string
  file_name: string
  mime_type?: string
}

export interface RegistrarDevolucionInput extends EntradaDevolucion {
  soporte?: SoporteDevolucionInput
}

export type ResultadoDevolucion =
  | { success: true; cerro_caso: boolean; ya_cerrado: boolean; neto_despues: number }
  | { success: false; error: string }

async function registrarDevolucionDineroSinClave(
  input: RegistrarDevolucionInput,
): Promise<ResultadoDevolucion> {
  const ctx = await ctxPagosExternos()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { workspaceId, userId, staffId } = ctx

  const entrada: EntradaDevolucion = {
    negocio_id: (input.negocio_id ?? '').trim(),
    monto: Number(input.monto),
    fecha: (input.fecha ?? '').trim(),
    motivo: (input.motivo ?? '').trim().slice(0, 500),
    cerrar_caso: input.cerrar_caso === true,
    razon_cierre: input.razon_cierre?.trim() || undefined,
  }
  const error = validarDevolucion(entrada, todayBogotaISO())
  if (error) return { success: false, error }

  // El soporte se guarda por referencia a Storage de ONE y se abre por /api/archivos/abrir,
  // que exige sesión del mismo workspace. No se copia a Drive: nace cerrado.
  let soporte: Record<string, unknown> | null = null
  if (input.soporte?.storage_path) {
    if (!esRutaDeWorkspace(input.soporte.storage_path, workspaceId)) {
      return { success: false, error: 'El soporte no corresponde a este espacio. Vuelve a adjuntarlo.' }
    }
    soporte = {
      url: construirReferenciaOne(BUCKET_DOCUMENTOS_ONE, input.soporte.storage_path),
      storage_path: input.soporte.storage_path,
      file_name: (input.soporte.file_name || 'soporte').slice(0, 200),
      mime_type: input.soporte.mime_type || null,
      subido_por: userId,
      subido_en: new Date().toISOString(),
    }
  }

  const razonLabel = entrada.razon_cierre ? etiquetaRazonCierre(entrada.razon_cierre) : null

  const svc = createServiceClient()
  const { data, error: rpcErr } = await db(svc).rpc('registrar_devolucion_dinero', {
    p_workspace_id: workspaceId,
    p_negocio_id: entrada.negocio_id,
    p_fecha: entrada.fecha,
    p_monto: entrada.monto,
    p_motivo: entrada.motivo,
    p_soporte: soporte,
    p_cerrar_caso: entrada.cerrar_caso,
    p_razon_cierre: entrada.cerrar_caso ? (entrada.razon_cierre ?? null) : null,
    p_razon_label: razonLabel,
    p_profile_id: userId,
    p_staff_id: staffId,
  })
  if (rpcErr) {
    console.error('[devoluciones] registrar_devolucion_dinero falló:', rpcErr)
    return { success: false, error: 'No se pudo registrar la devolución. Intenta de nuevo.' }
  }

  const r = data as RespuestaRegistro | null
  if (!r) return { success: false, error: 'No se pudo registrar la devolución. Intenta de nuevo.' }
  if (!r.ok) return { success: false, error: mensajeDeRechazo(r) }

  revalidatePath(`/negocios/${entrada.negocio_id}`)
  revalidatePath('/conciliacion')
  if (r.cerro_caso) revalidatePath('/negocios')
  return {
    success: true,
    cerro_caso: r.cerro_caso,
    ya_cerrado: r.ya_cerrado,
    neto_despues: Number(r.neto_despues ?? 0),
  }
}

export async function registrarDevolucionDinero(input: RegistrarDevolucionInput, intencion?: string) {
  return accionIdempotente<ResultadoDevolucion>(
    {
      accion: 'registrarDevolucionDinero',
      clave: intencion,
      args: [input],
      enCurso: () => ({ success: false, error: MENSAJE_EN_CURSO }),
    },
    () => registrarDevolucionDineroSinClave(input),
  )
}

// ── Panel de Tesorería ───────────────────────────────────────────────────────

export interface NegocioDevolvible {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  empresa: string | null
  estado: string
  cobrado: number
  devuelto: number
  neto: number
}

export interface DevolucionFila {
  id: string
  negocio_id: string
  codigo: string | null
  nombre: string | null
  fecha: string
  monto: number
  motivo: string
  cerro_caso: boolean
  soporte_url: string | null
  soporte_nombre: string | null
  autor: string | null
  created_at: string
}

export interface PanelDevoluciones {
  workspace_id: string
  /** Negocios con recaudado neto mayor a cero, abiertos o cerrados. */
  negocios: NegocioDevolvible[]
  devoluciones: DevolucionFila[]
}

/**
 * Lo que necesita la pestaña: los negocios a los que se les puede devolver (recaudado neto
 * mayor a cero, sin importar si están abiertos o cerrados: el caso típico es uno perdido) y
 * las devoluciones ya registradas.
 */
export async function getPanelDevoluciones(): Promise<{ data: PanelDevoluciones | null; error?: string }> {
  const ctx = await ctxPagosExternos()
  if (!ctx.ok) return { data: null, error: ctx.error }
  const { supabase, workspaceId } = ctx

  try {
    const [cobros, devoluciones, negocios] = await Promise.all([
      // Solo lo que ya entró: un `programado` sin fecha es una cuota por pagar.
      traerTodo<{ negocio_id: string | null; monto: number | null; tipo_cobro: string | null }>(
        (desde, hasta) =>
          db(supabase)
            .from('cobros')
            .select('negocio_id, monto, tipo_cobro')
            .eq('workspace_id', workspaceId)
            .not('negocio_id', 'is', null)
            .not('fecha', 'is', null)
            .order('id')
            .range(desde, hasta),
        { etiqueta: 'devoluciones:cobros' },
      ),
      traerTodo<{
        id: string
        negocio_id: string
        fecha: string
        monto: number
        motivo: string
        cerro_caso: boolean
        soporte: { url?: string; file_name?: string } | null
        creado_por_staff: string | null
        created_at: string
      }>(
        (desde, hasta) =>
          db(supabase)
            .from('devoluciones_dinero')
            .select('id, negocio_id, fecha, monto, motivo, cerro_caso, soporte, creado_por_staff, created_at')
            .eq('workspace_id', workspaceId)
            .order('id')
            .range(desde, hasta),
        { etiqueta: 'devoluciones:devoluciones' },
      ),
      // Todos los negocios del workspace y el cruce en memoria: un `.in()` con cientos de ids
      // revienta la cabecera de PostgREST.
      traerTodo<{
        id: string
        codigo: string | null
        nombre: string | null
        estado: string
        empresas: { nombre: string | null } | null
      }>(
        (desde, hasta) =>
          db(supabase)
            .from('negocios')
            .select('id, codigo, nombre, estado, empresas:empresa_id ( nombre )')
            .eq('workspace_id', workspaceId)
            .order('id')
            .range(desde, hasta),
        { etiqueta: 'devoluciones:negocios' },
      ),
    ])

    const cobrado = new Map<string, number>()
    for (const c of cobros) {
      if (!c.negocio_id || c.tipo_cobro === 'devolucion_pendiente') continue
      cobrado.set(c.negocio_id, (cobrado.get(c.negocio_id) ?? 0) + Number(c.monto ?? 0))
    }
    const devuelto = new Map<string, number>()
    for (const d of devoluciones) {
      devuelto.set(d.negocio_id, (devuelto.get(d.negocio_id) ?? 0) + Number(d.monto ?? 0))
    }

    const porId = new Map(negocios.map((n) => [n.id, n]))
    const devolvibles: NegocioDevolvible[] = []
    for (const [negocioId, total] of cobrado) {
      const n = porId.get(negocioId)
      if (!n) continue
      const dev = devuelto.get(negocioId) ?? 0
      const neto = recaudadoNeto(total, dev)
      if (neto <= 0) continue
      devolvibles.push({
        negocio_id: negocioId,
        codigo: n.codigo,
        nombre: n.nombre,
        empresa: n.empresas?.nombre ?? null,
        estado: n.estado,
        cobrado: total,
        devuelto: dev,
        neto,
      })
    }
    devolvibles.sort((a, b) => (b.codigo ?? '').localeCompare(a.codigo ?? '', 'es', { numeric: true }))

    const staffIds = Array.from(
      new Set(devoluciones.map((d) => d.creado_por_staff).filter((v): v is string => !!v)),
    )
    const nombres = new Map<string, string>()
    if (staffIds.length > 0) {
      const { data: staff } = await db(supabase)
        .from('staff')
        .select('id, full_name')
        .eq('workspace_id', workspaceId)
        .in('id', staffIds)
      for (const s of (staff ?? []) as Array<{ id: string; full_name: string | null }>) {
        if (s.full_name) nombres.set(s.id, s.full_name)
      }
    }

    const filas: DevolucionFila[] = devoluciones
      .map((d) => {
        const n = porId.get(d.negocio_id)
        return {
          id: d.id,
          negocio_id: d.negocio_id,
          codigo: n?.codigo ?? null,
          nombre: n?.empresas?.nombre ?? n?.nombre ?? null,
          fecha: d.fecha,
          monto: Number(d.monto),
          motivo: d.motivo,
          cerro_caso: d.cerro_caso,
          soporte_url: d.soporte?.url ?? null,
          soporte_nombre: d.soporte?.file_name ?? null,
          autor: d.creado_por_staff ? (nombres.get(d.creado_por_staff) ?? null) : null,
          created_at: d.created_at,
        }
      })
      .sort((a, b) => (b.fecha + b.created_at).localeCompare(a.fecha + a.created_at))

    return { data: { workspace_id: workspaceId, negocios: devolvibles, devoluciones: filas } }
  } catch (e) {
    console.error('[devoluciones] panel:', e)
    return { data: null, error: 'No se pudieron cargar las devoluciones' }
  }
}
