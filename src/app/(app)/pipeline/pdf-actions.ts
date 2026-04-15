'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { renderToBuffer } from '@react-pdf/renderer'
import CotizacionPDF from '@/lib/pdf/cotizacion-pdf'
import { calcularFiscal, type FiscalProfile } from '@/lib/fiscal/calculos'
import { createElement } from 'react'

export async function generateCotizacionPDF(cotizacionId: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get cotización (left join — puede ser de oportunidad o de negocio)
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('*, oportunidades(empresa_id, contacto_id, descripcion)')
    .eq('id', cotizacionId)
    .single()

  if (!cot) return { success: false, error: 'Cotización no encontrada' }

  // Get empresa: primero por oportunidad, luego por negocio, luego fallback
  let empresa: {
    nombre: string | null
    numero_documento: string | null
    contacto_nombre: string | null
    contacto_email: string | null
    tipo_persona: string | null
    regimen_tributario: string | null
    gran_contribuyente: boolean | null
    agente_retenedor: boolean | null
  } | null = null

  const opp = cot.oportunidades as { empresa_id: string | null } | null
  if (opp?.empresa_id) {
    const { data: empData } = await supabase
      .from('empresas')
      .select('nombre, numero_documento, contacto_nombre, contacto_email, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, telefono, direccion_fiscal, municipio, departamento')
      .eq('id', opp.empresa_id)
      .single()
    empresa = empData
  }

  // Para cotizaciones de negocio, intentar obtener empresa del negocio
  if (!empresa && (cot as any).negocio_id) {
    const { data: negocio } = await (supabase as any)
      .from('negocios')
      .select('empresa_id, empresas(nombre, numero_documento, contacto_nombre, contacto_email, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, telefono, direccion_fiscal, municipio, departamento)')
      .eq('id', (cot as any).negocio_id)
      .single()
    empresa = (negocio as any)?.empresas ?? null
  }

  // Fallback: empresa genérica para renderizar el PDF
  if (!empresa) {
    empresa = {
      nombre: 'Cliente',
      numero_documento: null,
      contacto_nombre: null,
      contacto_email: null,
      tipo_persona: 'juridica',
      regimen_tributario: 'responsable',
      gran_contribuyente: false,
      agente_retenedor: false,
    }
  }

  // Get workspace (vendor) info
  const { data: ws } = await supabase
    .from('workspaces')
    .select('name, logo_url, color_primario')
    .eq('id', workspaceId)
    .single()

  // Get vendor fiscal profile
  const { data: vendorFiscal } = await supabase
    .from('fiscal_profiles')
    .select('person_type, tax_regime, self_withholder, ica_rate, ica_city, nit, razon_social, telefono, email_fiscal, direccion_fiscal, municipio, departamento')
    .eq('workspace_id', workspaceId)
    .single()

  // Get items for detailed cotizaciones (precio_venta for client PDF, no internal rubros)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let items: any[] = []
  if (cot.modo === 'detallada') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: itemsData } = await (supabase as any)
      .from('items')
      .select('nombre, descripcion, precio_venta, descuento_porcentaje, cantidad')
      .eq('cotizacion_id', cotizacionId)
      .order('orden')
    items = itemsData ?? []
  }

  // Calculate fiscal
  const vendorProfile: FiscalProfile = {
    tipo_persona: (vendorFiscal?.person_type as 'natural' | 'juridica') || 'natural',
    regimen_tributario: (vendorFiscal?.tax_regime as any) || 'responsable',
    gran_contribuyente: false,
    agente_retenedor: false,
    autorretenedor: vendorFiscal?.self_withholder ?? false,
    ica_rate: vendorFiscal?.ica_rate ?? null,
    ica_city: vendorFiscal?.ica_city ?? null,
  }

  const buyerProfile: FiscalProfile = {
    tipo_persona: (empresa.tipo_persona as 'natural' | 'juridica') || 'juridica',
    regimen_tributario: (empresa.regimen_tributario as any) || 'responsable',
    gran_contribuyente: empresa.gran_contribuyente ?? false,
    agente_retenedor: empresa.agente_retenedor ?? false,
    autorretenedor: false,
    ica_rate: null,
    ica_city: null,
  }

  const valorNeto = cot.valor_total - (cot.descuento_valor ?? 0)
  const fiscal = calcularFiscal(valorNeto, vendorProfile, buyerProfile)

  // Render PDF
  const element = createElement(CotizacionPDF, {
    cotizacion: {
      consecutivo: cot.consecutivo,
      descripcion: cot.descripcion,
      valor_total: cot.valor_total,
      modo: cot.modo,
      fecha_envio: cot.fecha_envio,
      fecha_validez: cot.fecha_validez,
      condiciones_pago: cot.condiciones_pago,
      notas: cot.notas,
      descuento_porcentaje: cot.descuento_porcentaje ?? 0,
      descuento_valor: cot.descuento_valor ?? 0,
    },
    empresa: {
      nombre: empresa.nombre ?? '',
      nit: empresa.numero_documento,
      contacto_nombre: empresa.contacto_nombre,
      contacto_email: empresa.contacto_email,
      telefono: (empresa as any).telefono ?? null,
      direccion: (empresa as any).direccion_fiscal ?? null,
      ciudad: [(empresa as any).municipio, (empresa as any).departamento].filter(Boolean).join(', ') || null,
    },
    vendedor: {
      nombre: ws?.name ?? 'Mi Empresa',
      razon_social: (vendorFiscal as any)?.razon_social ?? null,
      nit: vendorFiscal?.nit ?? null,
      logo_url: ws?.logo_url ?? null,
      color_primario: ws?.color_primario ?? '#10B981',
      telefono: (vendorFiscal as any)?.telefono ?? null,
      email: (vendorFiscal as any)?.email_fiscal ?? null,
      direccion: (vendorFiscal as any)?.direccion_fiscal ?? null,
      ciudad: [(vendorFiscal as any)?.municipio, (vendorFiscal as any)?.departamento].filter(Boolean).join(', ') || null,
    },
    items: items.map((i: { nombre: string; descripcion: string | null; precio_venta: number; descuento_porcentaje: number; cantidad?: number }) => ({
      nombre: i.nombre ?? '',
      descripcion: i.descripcion ?? null,
      precio_venta: Number(i.precio_venta) || 0,
      descuento_porcentaje: Number(i.descuento_porcentaje) || 0,
      cantidad: Number(i.cantidad) || 1,
    })),
    fiscal,
  })

  const buffer = await renderToBuffer(element as any)
  const base64 = Buffer.from(buffer).toString('base64')

  return {
    success: true,
    pdf: base64,
    filename: `${cot.consecutivo}.pdf`,
    fiscal,
  }
}
