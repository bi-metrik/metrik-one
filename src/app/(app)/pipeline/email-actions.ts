'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { Resend } from 'resend'
import { revalidatePath } from 'next/cache'
import { generateCotizacionPDF } from './pdf-actions'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function enviarCotizacionEmail(cotizacionId: string, emailTo: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Generate PDF
  const pdfResult = await generateCotizacionPDF(cotizacionId)
  if (!pdfResult.success || !pdfResult.pdf) {
    return { success: false, error: pdfResult.error || 'Error generando PDF' }
  }

  // Get cotización details for email
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('consecutivo, descripcion, valor_total, oportunidades!inner(empresa_id)')
    .eq('id', cotizacionId)
    .single()

  if (!cot) return { success: false, error: 'Cotización no encontrada' }

  // Get workspace name
  const { data: ws } = await supabase
    .from('workspaces')
    .select('name')
    .limit(1)
    .single()

  const senderName = ws?.name || 'MéTRIK one'
  const fmt = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

  // Access discount fields
  const { data: cotFull } = await supabase.from('cotizaciones').select('*').eq('id', cotizacionId).single()
  const descPct = cotFull?.descuento_porcentaje ?? 0
  const descVal = cotFull?.descuento_valor ?? 0
  const valorNeto = cot.valor_total - descVal
  const valorFmt = fmt(valorNeto)
  const tieneDescuento = descVal > 0

  try {
    const { error: emailError } = await resend.emails.send({
      from: `${senderName} <cotizaciones@metrikone.co>`,
      to: [emailTo],
      subject: `Cotización ${cot.consecutivo} - ${senderName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #10B981;">Cotización ${cot.consecutivo}</h2>
          <p>Hola,</p>
          <p>Adjunto encontrarás la cotización <strong>${cot.consecutivo}</strong> por un valor de <strong>${valorFmt}</strong>${tieneDescuento ? ` (incluye descuento del ${descPct}%)` : ''}.</p>
          ${cot.descripcion ? `<p style="color: #666;">${cot.descripcion}</p>` : ''}
          <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="font-size: 12px; color: #999;">
            Enviado desde ${senderName} vía MéTRIK one
          </p>
        </div>
      `,
      attachments: [
        {
          filename: pdfResult.filename!,
          content: pdfResult.pdf,
        },
      ],
    })

    if (emailError) {
      return { success: false, error: emailError.message }
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Error enviando email' }
  }

  // Update cotización state and email_enviado_a
  await supabase
    .from('cotizaciones')
    .update({
      estado: 'enviada',
      fecha_envio: new Date().toISOString(),
      email_enviado_a: emailTo,
    })
    .eq('id', cotizacionId)

  revalidatePath('/pipeline')
  return { success: true }
}
