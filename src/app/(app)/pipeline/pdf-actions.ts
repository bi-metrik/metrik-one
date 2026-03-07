'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { renderToBuffer } from '@react-pdf/renderer'
import CotizacionPDF from '@/lib/pdf/cotizacion-pdf'
import { calcularFiscal, type FiscalProfile } from '@/lib/fiscal/calculos'
import { createElement } from 'react'

export async function generateCotizacionPDF(cotizacionId: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get cotización
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('*, oportunidades!inner(empresa_id, contacto_id, descripcion)')
    .eq('id', cotizacionId)
    .single()

  if (!cot) return { success: false, error: 'Cotización no encontrada' }

  // Get empresa
  const { data: empresa } = await supabase
    .from('empresas')
    .select('nombre, numero_documento, contacto_nombre, contacto_email, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor')
    .eq('id', cot.oportunidades.empresa_id)
    .single()

  if (!empresa) return { success: false, error: 'Empresa no encontrada' }

  // Get workspace (vendor) info
  const { data: ws } = await supabase
    .from('workspaces')
    .select('name, logo_url, color_primario')
    .eq('id', workspaceId)
    .single()

  // Get vendor fiscal profile
  const { data: vendorFiscal } = await supabase
    .from('fiscal_profiles')
    .select('person_type, tax_regime, self_withholder, ica_rate, ica_city, nit')
    .eq('workspace_id', workspaceId)
    .single()

  // Get items + rubros for detailed cotizaciones
  let items: any[] = []
  if (cot.modo === 'detallada') {
    const { data: itemsData } = await supabase
      .from('items')
      .select('nombre, subtotal, rubros(tipo, descripcion, cantidad, unidad, valor_unitario, valor_total)')
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
      nombre: empresa.nombre,
      nit: empresa.numero_documento,
      contacto_nombre: empresa.contacto_nombre,
      contacto_email: empresa.contacto_email,
    },
    vendedor: {
      nombre: ws?.name ?? 'Mi Empresa',
      nit: vendorFiscal?.nit ?? null,
      logo_url: ws?.logo_url ?? null,
      color_primario: ws?.color_primario ?? '#10B981',
    },
    items: items.map(i => ({
      nombre: i.nombre,
      subtotal: i.subtotal,
      rubros: i.rubros ?? [],
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
