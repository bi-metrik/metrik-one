'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { renderToBuffer } from '@react-pdf/renderer'
import CotizacionPDF from '@/lib/pdf/cotizacion-pdf'
import { calcularFiscal, type FiscalProfile } from '@/lib/fiscal/calculos'
import { createElement } from 'react'
import {
  isPdfRenderConfigured,
  renderCotizacion as renderViaService,
  type CotizacionRenderPayload,
  type CotizacionRenderItem,
} from '@/lib/pdf/pdf-render-client'
import { uploadFileToDrive, createDriveFolder } from '@/lib/google-drive'

// Campos agregados por migration 20260515000001 — pendiente regenerar database.ts
// post-apply. Hasta entonces, accedemos via cast tipado a este shape.
type CotizacionNuevosCampos = {
  lugar_entrega: string | null
  tiempo_entrega: string | null
  anticipo_pct: number | null
  anticipo_terminos: string | null
  saldo_terminos: string | null
  observaciones_extra: string[] | null
}

function formatMoney(n: number): string {
  // Formato colombiano: 16.800.000 (sin signo, sin decimales)
  return Math.round(n).toLocaleString('es-CO').replace(/,/g, '.')
}

function extractDriveFolderId(url: string | null | undefined): string | null {
  if (!url) return null
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

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
  type EmpresaRow = {
    nombre: string | null
    numero_documento: string | null
    contacto_nombre: string | null
    contacto_email: string | null
    tipo_persona: string | null
    regimen_tributario: string | null
    gran_contribuyente: boolean | null
    agente_retenedor: boolean | null
    telefono?: string | null
    direccion_fiscal?: string | null
    municipio?: string | null
    departamento?: string | null
  }
  let empresa: EmpresaRow | null = null

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
  type NegocioInfo = { id: string; nombre: string | null; carpeta_url: string | null }
  let negocioInfo: NegocioInfo | null = null

  if (cot.negocio_id) {
    const { data: negocio } = await supabase
      .from('negocios')
      .select('id, nombre, carpeta_url, empresa_id, empresas(nombre, numero_documento, contacto_nombre, contacto_email, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, telefono, direccion_fiscal, municipio, departamento)')
      .eq('id', cot.negocio_id)
      .single()
    if (negocio) {
      negocioInfo = { id: negocio.id, nombre: negocio.nombre, carpeta_url: negocio.carpeta_url }
      if (!empresa) {
        empresa = (negocio.empresas as EmpresaRow | null) ?? null
      }
    }
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

  // Get workspace (vendor) info incluyendo template slug
  type WorkspaceRow = {
    name: string
    logo_url: string | null
    color_primario: string | null
    cotizacion_template_slug: string | null
  }
  const { data: wsRaw } = await supabase
    .from('workspaces')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select('name, logo_url, color_primario, cotizacion_template_slug' as any)
    .eq('id', workspaceId)
    .single()
  const ws = (wsRaw as unknown as WorkspaceRow | null) ?? null

  // Get vendor fiscal profile
  type VendorFiscalRow = {
    person_type: string | null
    tax_regime: string | null
    self_withholder: boolean | null
    ica_rate: number | null
    ica_city: string | null
    nit: string | null
    razon_social?: string | null
    telefono?: string | null
    email_fiscal?: string | null
    direccion_fiscal?: string | null
    municipio?: string | null
    departamento?: string | null
  }
  const { data: vendorFiscal } = await supabase
    .from('fiscal_profiles')
    .select('person_type, tax_regime, self_withholder, ica_rate, ica_city, nit, razon_social, telefono, email_fiscal, direccion_fiscal, municipio, departamento')
    .eq('workspace_id', workspaceId)
    .single<VendorFiscalRow>()

  // Get items
  type ItemRow = {
    nombre: string | null
    descripcion: string | null
    precio_venta: number
    descuento_porcentaje: number | null
    cantidad: number | null
  }
  let items: ItemRow[] = []
  if (cot.modo === 'detallada') {
    const { data: itemsData } = await supabase
      .from('items')
      .select('nombre, descripcion, precio_venta, descuento_porcentaje, cantidad')
      .eq('cotizacion_id', cotizacionId)
      .order('orden')
    items = (itemsData ?? []) as ItemRow[]
  }

  // Calculate fiscal
  type Regimen = FiscalProfile['regimen_tributario']
  const vendorProfile: FiscalProfile = {
    tipo_persona: (vendorFiscal?.person_type as 'natural' | 'juridica') || 'natural',
    regimen_tributario: (vendorFiscal?.tax_regime as Regimen) || 'responsable',
    gran_contribuyente: false,
    agente_retenedor: false,
    autorretenedor: vendorFiscal?.self_withholder ?? false,
    ica_rate: vendorFiscal?.ica_rate ?? null,
    ica_city: vendorFiscal?.ica_city ?? null,
  }

  const buyerProfile: FiscalProfile = {
    tipo_persona: (empresa.tipo_persona as 'natural' | 'juridica') || 'juridica',
    regimen_tributario: (empresa.regimen_tributario as Regimen) || 'responsable',
    gran_contribuyente: empresa.gran_contribuyente ?? false,
    agente_retenedor: empresa.agente_retenedor ?? false,
    autorretenedor: false,
    ica_rate: null,
    ica_city: null,
  }

  const valorNeto = cot.valor_total - (cot.descuento_valor ?? 0)
  const fiscal = calcularFiscal(valorNeto, vendorProfile, buyerProfile)

  // ============================================================
  // PATH A — Servicio WeasyPrint (template HTML por workspace)
  // ============================================================
  // Solo se usa si:
  //   - env vars METRIK_PDF_RENDER_* estan configuradas, Y
  //   - el workspace tiene cotizacion_template_slug distinto de 'metrik'
  //     (template 'metrik' aun no esta migrado, sigue usando @react-pdf hasta Fase 3)
  // ============================================================
  const templateSlug = ws?.cotizacion_template_slug ?? 'metrik'
  const useService = isPdfRenderConfigured() && templateSlug !== 'metrik'

  if (useService) {
    // Cast a la cotizacion para acceder a campos nuevos hasta regenerar database.ts
    const cotExt = cot as unknown as typeof cot & CotizacionNuevosCampos
    const subtotal = valorNeto
    const ivaPct = 19
    const ivaValor = fiscal.iva ?? 0
    const totalConIva = subtotal + ivaValor

    const renderItems: CotizacionRenderItem[] = items.map((it, idx) => {
      const cant = Number(it.cantidad) || 1
      const unit = Number(it.precio_venta) || 0
      const desc = Number(it.descuento_porcentaje) || 0
      const total = cant * unit * (1 - desc / 100)
      return {
        numero: idx + 1,
        descripcion: [it.nombre, it.descripcion].filter(Boolean).join('\n'),
        cantidad: String(cant),
        valor_unitario: formatMoney(unit),
        valor_total: formatMoney(total),
      }
    })

    const fechaEnvio = cot.fecha_envio
      ? new Date(cot.fecha_envio as string)
      : new Date()
    const fechaStr = `${fechaEnvio.getDate()}/${fechaEnvio.getMonth() + 1}/${fechaEnvio.getFullYear()}`

    // validez_dias: si hay fecha_validez calcular delta, sino default 30
    let validezDias = 30
    if (cot.fecha_validez && cot.fecha_envio) {
      const ms =
        new Date(cot.fecha_validez as string).getTime() -
        new Date(cot.fecha_envio as string).getTime()
      validezDias = Math.max(1, Math.round(ms / 86400000))
    }

    // observaciones_extra de la cotizacion + linea de forma de pago si hay anticipo
    const obsExtra: string[] = Array.isArray(cotExt.observaciones_extra)
      ? cotExt.observaciones_extra
      : []
    const observacionesExtra = [...obsExtra]
    if (cotExt.anticipo_pct) {
      const anticipoValor = subtotal * (Number(cotExt.anticipo_pct) / 100)
      const saldoValor = subtotal - anticipoValor
      const antTerms = cotExt.anticipo_terminos ?? 'CONTRA ORDEN DE COMPRA'
      const saldoTerms =
        cotExt.saldo_terminos ?? 'CONTRA ENTREGA FINAL DE ENTREGABLES'
      observacionesExtra.push(
        `<b>FORMA DE PAGO (VALORES SIN IVA):</b><br>` +
          `· ${cotExt.anticipo_pct}% ANTICIPO ${antTerms} — $${formatMoney(anticipoValor)}.<br>` +
          `· ${100 - Number(cotExt.anticipo_pct)}% SALDO ${saldoTerms} — $${formatMoney(saldoValor)}.<br>` +
          `EL IVA SE FACTURA PROPORCIONALMENTE EN CADA PAGO.`,
      )
    } else if (cot.condiciones_pago) {
      observacionesExtra.push(`<b>FORMA DE PAGO:</b> ${cot.condiciones_pago}`)
    }

    const payload: CotizacionRenderPayload = {
      numero_cot: cot.codigo ?? String(cot.consecutivo ?? ''),
      cliente: empresa.nombre ?? 'Cliente',
      nit_cliente: empresa.numero_documento ?? '',
      proyecto: negocioInfo?.nombre ?? cot.descripcion ?? '',
      fecha: fechaStr,
      items: renderItems,
      subtotal: formatMoney(subtotal),
      iva_pct: ivaPct,
      iva_valor: formatMoney(ivaValor),
      valor_total_con_iva: formatMoney(totalConIva),
      lugar_entrega: cotExt.lugar_entrega ?? '',
      validez_dias: validezDias,
      tiempo_entrega: cotExt.tiempo_entrega ?? 'POR DEFINIR CON LA ORDEN DE COMPRA',
      observaciones_extra: observacionesExtra,
      powered_by_metrik: true, // workspaces no-MeTRIK siempre llevan Powered by
    }

    try {
      const buffer = await renderViaService(templateSlug, payload)
      const filename = `${cot.codigo ?? cot.consecutivo}.pdf`

      // Subida opcional a Drive si el negocio tiene carpeta configurada.
      // createDriveFolder() es find-or-create (busca por nombre+parent antes de crear).
      let driveFileId: string | null = null
      let driveWebViewLink: string | null = null
      const driveFolderId = extractDriveFolderId(negocioInfo?.carpeta_url)
      if (driveFolderId && negocioInfo) {
        try {
          const subFolderId = await createDriveFolder(
            'cotizaciones',
            driveFolderId,
            workspaceId,
          )
          const uploaded = await uploadFileToDrive(
            buffer,
            filename,
            'application/pdf',
            subFolderId,
            workspaceId,
          )
          driveFileId = uploaded.fileId
          driveWebViewLink = uploaded.webViewLink
        } catch (e) {
          // No bloquear el PDF si falla la subida — solo log
          console.warn('[cotizacion-pdf] Drive upload failed:', (e as Error).message)
        }
      }

      return {
        success: true,
        pdf: buffer.toString('base64'),
        filename,
        fiscal,
        driveFileId,
        driveWebViewLink,
        renderedVia: 'weasyprint' as const,
      }
    } catch (e) {
      console.error('[cotizacion-pdf] Service render failed, falling back to react-pdf:', (e as Error).message)
      // cae al PATH B abajo
    }
  }

  // ============================================================
  // PATH B (fallback) — @react-pdf/renderer (legacy, pre-Fase 2)
  // ============================================================
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
      telefono: empresa.telefono ?? null,
      direccion: empresa.direccion_fiscal ?? null,
      ciudad: [empresa.municipio, empresa.departamento].filter(Boolean).join(', ') || null,
    },
    vendedor: {
      nombre: ws?.name ?? 'Mi Empresa',
      razon_social: vendorFiscal?.razon_social ?? null,
      nit: vendorFiscal?.nit ?? null,
      logo_url: ws?.logo_url ?? null,
      color_primario: ws?.color_primario ?? '#10B981',
      telefono: vendorFiscal?.telefono ?? null,
      email: vendorFiscal?.email_fiscal ?? null,
      direccion: vendorFiscal?.direccion_fiscal ?? null,
      ciudad: [vendorFiscal?.municipio, vendorFiscal?.departamento].filter(Boolean).join(', ') || null,
    },
    items: items.map(i => ({
      nombre: i.nombre ?? '',
      descripcion: i.descripcion ?? null,
      precio_venta: Number(i.precio_venta) || 0,
      descuento_porcentaje: Number(i.descuento_porcentaje) || 0,
      cantidad: Number(i.cantidad) || 1,
    })),
    fiscal,
  })

  // renderToBuffer espera DocumentElement; nuestro createElement lo produce correctamente en runtime
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any)
  const base64 = Buffer.from(buffer).toString('base64')

  return {
    success: true,
    pdf: base64,
    filename: `${cot.consecutivo}.pdf`,
    fiscal,
    renderedVia: 'react-pdf' as const,
  }
}
