'use server'

/**
 * Cola de facturación del área financiera.
 *
 * Facturar dejó de ser una etapa del flujo: se habilita cuando el negocio supera
 * Documentación y vive en UNA sola superficie, este panel. El botón que aparezca
 * en el negocio es navegación hacia aquí, no una segunda vía de escritura
 * (decisión de Mauricio, 2026-08-06). Spec:
 * `docs/specs/2026-08-06_facturacion-fuera-del-flujo.md`.
 *
 * Esta acción SOLO LEE. No crea documentos en Siigo ni toca el negocio.
 */

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { canEditBloque, type Area, type Role, type UserContext } from '@/lib/permissions/can-edit'
import { borradorCliente, borradorFactura, borradorRecibo, type RutExtraido } from '@/lib/siigo/mapeo'
import type { SiigoConfig } from '@/lib/siigo/client'

export interface CasoPorFacturar {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  etapa: string | null
  etapa_numero: number | null
  identificacion: string | null
  cliente: string | null
  /** Honorario aprobado, CON IVA (es como ONE guarda `precio_aprobado`). */
  honorario: number | null
  /** Valor pagado a la UPME según el comprobante cargado. Recaudo de terceros. */
  valor_upme: number | null
  /** Qué le falta al borrador de la factura para poder emitirse. */
  faltan_factura: string[]
  /** Qué le falta al borrador del cliente. */
  faltan_cliente: string[]
  /** Qué le falta al borrador del recibo del recaudo UPME. */
  faltan_recibo: string[]
  /** Ya tiene número de factura registrado en el negocio. */
  ya_facturado: boolean
}

export interface ColaFacturacion {
  casos: CasoPorFacturar[]
  /** Etapa (numero visible) a partir de la cual se habilita facturar. */
  desde_etapa_numero: number | null
  /** El workspace no tiene Siigo configurado: la cola se ve, pero no se emite. */
  siigo_configurado: boolean
  totales: { listos: number; incompletos: number; ya_facturados: number; valor_listo: number }
}

/**
 * Mismo criterio de área que el panel de conciliación: `canEditBloque` sobre el
 * stage de cobro. Facturar es del área financiera, no de quien lleva el caso.
 */
async function ctxFinanciero(): Promise<
  { ok: true; workspaceId: string } | { ok: false; error: string }
> {
  const { workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: error ?? 'No autenticado' }
  const user: UserContext = {
    id: staffId ?? '',
    role: (role ?? 'read_only') as Role,
    areas: (areas ?? []) as Area[],
  }
  if (!canEditBloque(user, { stage: 'cobro' }, [])) {
    return { ok: false, error: 'Solo el área financiera puede facturar' }
  }
  return { ok: true, workspaceId }
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export async function getColaFacturacion(): Promise<{ data: ColaFacturacion | null; error?: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { data: null, error: ctx.error }
  const { workspaceId } = ctx
  const svc = createServiceClient()

  // ── Configuración del workspace ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ws } = await (svc as any)
    .from('workspaces').select('config_extra').eq('id', workspaceId).single()
  const cfgWs = (ws?.config_extra ?? {}) as Record<string, unknown>
  const siigoCfg = cfgWs.siigo_config as SiigoConfig | undefined
  const siigo_configurado = !!siigoCfg && !!cfgWs.siigo_access_key

  // ── Desde qué etapa se habilita ──
  // Opt-in por línea. Sin el dato NO se asume nada: la cola sale vacía y la
  // pantalla lo dice, en vez de inventar un criterio y llenar la bandeja de
  // casos que nadie mandó facturar.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lineas } = await (svc as any)
    .from('lineas_negocio').select('id, config_extra').eq('workspace_id', workspaceId)
  let desde: number | null = null
  for (const l of ((lineas ?? []) as Array<{ config_extra?: Record<string, unknown> | null }>)) {
    const f = (l.config_extra?.facturacion ?? {}) as { desde_etapa_numero?: number }
    if (typeof f.desde_etapa_numero === 'number') { desde = f.desde_etapa_numero; break }
  }
  if (desde == null) {
    return { data: { casos: [], desde_etapa_numero: null, siigo_configurado, totales: { listos: 0, incompletos: 0, ya_facturados: 0, valor_listo: 0 } } }
  }

  // ── Negocios candidatos ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negocios } = await (svc as any)
    .from('negocios')
    .select('id, codigo, nombre, precio_aprobado, contacto_id, etapas_negocio!inner(nombre, numero)')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'abierto')
  type Neg = {
    id: string; codigo: string | null; nombre: string | null
    precio_aprobado: number | null; contacto_id: string | null
    etapas_negocio: { nombre: string | null; numero: number | null } | null
  }
  const candidatos = ((negocios ?? []) as Neg[])
    .filter(n => (n.etapas_negocio?.numero ?? 0) > desde!)
  if (candidatos.length === 0) {
    return { data: { casos: [], desde_etapa_numero: desde, siigo_configurado, totales: { listos: 0, incompletos: 0, ya_facturados: 0, valor_listo: 0 } } }
  }
  const ids = candidatos.map(n => n.id)

  // ── Bloques que alimentan los borradores ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bloques } = await (svc as any)
    .from('negocio_bloques')
    .select('negocio_id, data, bloque_configs!inner(slug)')
    .in('negocio_id', ids)
    .in('bloque_configs.slug', ['rut', 'comprobante_pago_upme', 'factura_emitida'])
  type Bl = { negocio_id: string; data: { campos?: Record<string, { value?: unknown }> } | null; bloque_configs: { slug: string } }

  const rutPorNegocio = new Map<string, RutExtraido>()
  const upmePorNegocio = new Map<string, number>()
  const facturadoPorNegocio = new Set<string>()

  for (const b of ((bloques ?? []) as unknown as Bl[])) {
    const campos = b.data?.campos ?? {}
    const slug = b.bloque_configs?.slug
    if (slug === 'rut') {
      const plano: Record<string, string> = {}
      for (const [k, v] of Object.entries(campos)) {
        if (v?.value != null && v.value !== '') plano[k] = String(v.value)
      }
      if (plano.numero_identificacion || plano.nit) rutPorNegocio.set(b.negocio_id, plano as RutExtraido)
    } else if (slug === 'comprobante_pago_upme') {
      const v = num(campos.valor_pagado?.value)
      if (v && v > 0) upmePorNegocio.set(b.negocio_id, v)
    } else if (slug === 'factura_emitida') {
      const n = String(campos.numero_factura?.value ?? '').trim()
      if (n) facturadoPorNegocio.add(b.negocio_id)
    }
  }

  // ── Contactos (email y teléfono ganan sobre el RUT: los mantiene el comercial) ──
  const contactoIds = candidatos.map(n => n.contacto_id).filter((x): x is string => !!x)
  const contactos = new Map<string, { email: string | null; telefono: string | null }>()
  if (contactoIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cs } = await (svc as any)
      .from('contactos').select('id, email, telefono').in('id', contactoIds)
    for (const c of ((cs ?? []) as Array<{ id: string; email: string | null; telefono: string | null }>)) {
      contactos.set(c.id, { email: c.email, telefono: c.telefono })
    }
  }

  // Config de respaldo solo para poder EVALUAR los borradores cuando el workspace
  // aún no tiene Siigo configurado. No se usa para emitir: sin configuración real
  // el panel no deja enviar nada.
  const cfgEval: SiigoConfig = siigoCfg ?? {
    facturaDocumentId: 0, reciboDocumentId: 0, sellerId: 0,
    productoCode: '', ivaId: 0, facturaPaymentId: 0, reciboPaymentId: 0,
  }
  const hoy = new Date().toISOString().slice(0, 10)

  const casos: CasoPorFacturar[] = candidatos.map(n => {
    const rut = rutPorNegocio.get(n.id) ?? {}
    const contacto = contactos.get(n.contacto_id ?? '') ?? { email: null, telefono: null }
    const cli = borradorCliente(rut, contacto)
    const honorario = n.precio_aprobado == null ? null : Number(n.precio_aprobado)
    const fac = borradorFactura(cfgEval, cli.payload.identification, honorario, hoy, 19)
    const upme = upmePorNegocio.get(n.id) ?? null
    const rec = borradorRecibo(cfgEval, cli.payload.identification, upme, hoy)

    return {
      negocio_id: n.id,
      codigo: n.codigo,
      nombre: n.nombre,
      etapa: n.etapas_negocio?.nombre ?? null,
      etapa_numero: n.etapas_negocio?.numero ?? null,
      identificacion: cli.payload.identification || null,
      cliente: cli.payload.name.filter(Boolean).join(' ') || null,
      honorario,
      valor_upme: upme,
      faltan_factura: fac.faltantes,
      faltan_cliente: cli.faltantes,
      faltan_recibo: rec.faltantes,
      ya_facturado: facturadoPorNegocio.has(n.id),
    }
  })

  // Pendientes primero, y dentro de esos los que ya están listos para emitir:
  // la cola debe abrir por lo que se puede resolver hoy.
  const listo = (c: CasoPorFacturar) => c.faltan_factura.length === 0 && c.faltan_cliente.length === 0
  casos.sort((a, b) => {
    if (a.ya_facturado !== b.ya_facturado) return a.ya_facturado ? 1 : -1
    if (listo(a) !== listo(b)) return listo(a) ? -1 : 1
    return (b.honorario ?? 0) - (a.honorario ?? 0)
  })

  const pendientes = casos.filter(c => !c.ya_facturado)
  return {
    data: {
      casos,
      desde_etapa_numero: desde,
      siigo_configurado,
      totales: {
        listos: pendientes.filter(listo).length,
        incompletos: pendientes.filter(c => !listo(c)).length,
        ya_facturados: casos.filter(c => c.ya_facturado).length,
        valor_listo: pendientes.filter(listo).reduce((s, c) => s + (c.honorario ?? 0), 0),
      },
    },
  }
}
