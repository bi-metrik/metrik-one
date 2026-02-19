'use client'

import { useState } from 'react'
import { FileText, Loader2, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { numeroALetras } from '@/lib/numero-a-letras'

interface CuentaCobroPdfProps {
  invoice: {
    concept: string
    gross_amount: number
    invoice_number: string | null
  }
  clientName: string
  projectName: string
  /** Workspace emitter info — fetched from config or defaults */
  emitter?: {
    name: string
    document: string
    address: string
    phone: string
    bankName: string
    accountType: string
    accountNumber: string
  }
  onClose: () => void
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

function formatearFecha(fecha: Date): string {
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `${fecha.getDate()} de ${meses[fecha.getMonth()]} de ${fecha.getFullYear()}`
}

export default function CuentaCobroPdf({ invoice, clientName, projectName, emitter, onClose }: CuentaCobroPdfProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [clienteNombre, setClienteNombre] = useState(clientName || '')
  const [clienteNit, setClienteNit] = useState('')
  const [concepto, setConcepto] = useState(invoice.concept || `Servicios profesionales - ${projectName}`)

  const generarPdf = async () => {
    if (!clienteNombre.trim()) {
      toast.error('Ingresa el nombre del cliente')
      return
    }

    setIsGenerating(true)
    try {
      const fechaActual = new Date()
      const valorEnLetras = numeroALetras(invoice.gross_amount) + ' pesos colombianos'
      const consecutivo = invoice.invoice_number || 'CC-0001'

      const em = emitter || {
        name: 'Nombre del emisor',
        document: '---',
        address: '---',
        phone: '---',
        bankName: '---',
        accountType: 'Cuenta de Ahorro',
        accountNumber: '---',
      }

      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Cuenta de Cobro ${consecutivo}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: letter; margin: 2cm; }
    body { font-family: 'Montserrat', Arial, sans-serif; font-size: 11pt; line-height: 1.6; color: #333; padding: 40px; max-width: 800px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 3px solid #10b981; }
    .titulo { font-size: 24pt; font-weight: 700; color: #111; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 2px; }
    .consecutivo { font-size: 14pt; color: #10b981; font-weight: 600; }
    .seccion { margin-bottom: 25px; }
    .seccion-titulo { font-size: 12pt; font-weight: 600; color: #10b981; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; }
    .info-grid { display: grid; grid-template-columns: 140px 1fr; gap: 5px 15px; }
    .info-label { font-weight: 600; color: #555; }
    .info-valor { color: #111; }
    .fecha-emision { text-align: right; font-size: 11pt; color: #666; margin-bottom: 25px; }
    .concepto-box { background: #f8f9fa; border-left: 4px solid #10b981; padding: 15px 20px; margin: 15px 0; }
    .valor-total { background: #10b981; color: white; padding: 20px; margin: 25px 0; border-radius: 8px; }
    .valor-numero { font-size: 28pt; font-weight: 700; text-align: center; margin-bottom: 5px; }
    .valor-letras { font-size: 11pt; text-align: center; font-style: italic; opacity: 0.9; }
    .pago-info { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 15px 20px; border-radius: 8px; margin: 20px 0; }
    .declaracion { background: #fffbeb; border: 1px solid #fde68a; padding: 15px 20px; border-radius: 8px; margin: 25px 0; font-size: 10pt; }
    .declaracion-titulo { font-weight: 600; color: #92400e; margin-bottom: 8px; }
    .firma-seccion { margin-top: 50px; text-align: center; }
    .firma-linea { border-top: 2px solid #333; width: 300px; margin: 0 auto 10px; padding-top: 10px; }
    .firma-nombre { font-weight: 600; font-size: 12pt; }
    .firma-cedula { color: #666; font-size: 10pt; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; text-align: center; font-size: 9pt; color: #999; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="titulo">Cuenta de Cobro</div>
    <div class="consecutivo">No. ${consecutivo}</div>
  </div>
  <div class="fecha-emision">Bogotá D.C., ${formatearFecha(fechaActual)}</div>
  <div class="seccion">
    <div class="seccion-titulo">Datos del Prestador del Servicio</div>
    <div class="info-grid">
      <span class="info-label">Nombre:</span><span class="info-valor">${em.name}</span>
      <span class="info-label">C.C.:</span><span class="info-valor">${em.document}</span>
      <span class="info-label">Dirección:</span><span class="info-valor">${em.address}</span>
      <span class="info-label">Teléfono:</span><span class="info-valor">${em.phone}</span>
    </div>
  </div>
  <div class="seccion">
    <div class="seccion-titulo">Datos del Cliente</div>
    <div class="info-grid">
      <span class="info-label">Razón Social:</span><span class="info-valor">${clienteNombre}</span>
      ${clienteNit ? `<span class="info-label">NIT:</span><span class="info-valor">${clienteNit}</span>` : ''}
    </div>
  </div>
  <div class="seccion">
    <div class="seccion-titulo">Concepto</div>
    <div class="concepto-box">${concepto}</div>
  </div>
  <div class="valor-total">
    <div class="valor-numero">${fmt(invoice.gross_amount)}</div>
    <div class="valor-letras">(${valorEnLetras})</div>
  </div>
  <div class="pago-info">
    <div class="seccion-titulo" style="color: #166534; margin-bottom: 10px;">Información para el Pago</div>
    <div class="info-grid">
      <span class="info-label">Banco:</span><span class="info-valor">${em.bankName}</span>
      <span class="info-label">Tipo de Cuenta:</span><span class="info-valor">${em.accountType}</span>
      <span class="info-label">No. de Cuenta:</span><span class="info-valor">${em.accountNumber}</span>
      <span class="info-label">Titular:</span><span class="info-valor">${em.name}</span>
      <span class="info-label">C.C.:</span><span class="info-valor">${em.document}</span>
    </div>
  </div>
  <div class="declaracion">
    <div class="declaracion-titulo">Declaración Juramentada - Art. 383 E.T.</div>
    <p>Bajo la gravedad del juramento, manifiesto que mis ingresos provienen de la prestación de servicios profesionales por concepto de rentas de trabajo, y que NO tomaré costos ni deducciones asociados a estas rentas en mi declaración de renta. Por lo anterior, solicito la aplicación de la retención en la fuente según la tabla del Artículo 383 del Estatuto Tributario, conforme a lo establecido en el Decreto 2231 de 2023.</p>
  </div>
  <div class="firma-seccion">
    <div class="firma-linea">
      <div class="firma-nombre">${em.name}</div>
      <div class="firma-cedula">C.C. ${em.document}</div>
    </div>
  </div>
  <div class="footer">Documento generado el ${fechaActual.toLocaleDateString('es-CO')} a las ${fechaActual.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</div>
</body>
</html>`

      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        toast.error('Permite las ventanas emergentes para generar el PDF')
        return
      }
      printWindow.document.write(htmlContent)
      printWindow.document.close()
      setTimeout(() => printWindow.print(), 500)
      toast.success('Cuenta de cobro generada')
      onClose()
    } catch {
      toast.error('Error al generar la cuenta de cobro')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-background p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-green-500" />
            Generar Cuenta de Cobro
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {invoice.invoice_number && (
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">Consecutivo</p>
            <p className="font-bold text-green-500">{invoice.invoice_number}</p>
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-muted-foreground">Cliente *</label>
          <input
            type="text"
            value={clienteNombre}
            onChange={e => setClienteNombre(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Nombre o razón social"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">NIT (opcional)</label>
          <input
            type="text"
            value={clienteNit}
            onChange={e => setClienteNit(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="900.123.456-7"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Concepto</label>
          <textarea
            value={concepto}
            onChange={e => setConcepto(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm resize-none"
          />
        </div>

        <div className="rounded-lg bg-green-50 border border-green-200 p-3 dark:bg-green-950/10 dark:border-green-900/30">
          <p className="text-xs text-muted-foreground">Valor a cobrar</p>
          <p className="text-xl font-bold text-green-600">{fmt(invoice.gross_amount)}</p>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm hover:bg-accent">
            Cancelar
          </button>
          <button
            onClick={generarPdf}
            disabled={isGenerating || !clienteNombre.trim()}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Generar PDF
          </button>
        </div>
      </div>
    </div>
  )
}
