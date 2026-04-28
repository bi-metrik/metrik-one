import { Info } from 'lucide-react'

interface Props {
  className?: string
}

/**
 * Disclaimer fiscal — copy aprobado por Emilio (CLO) 2026-04-27.
 * Render en /revision, /movimientos, /nuevo/gasto, /numeros drill-down impuestos.
 * Tokens marca: Gris Acero #6B7280, Fondo Crema #F5F4F2, Montserrat (heredado de body).
 */
export function FiscalDisclaimer({ className = '' }: Props) {
  return (
    <div
      className={`flex items-start gap-2 rounded-md border border-[#E5E7EB] bg-[#F5F4F2] px-3 py-2.5 text-[11px] leading-relaxed text-[#6B7280] ${className}`}
      role="note"
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6B7280]" aria-hidden="true" />
      <p>
        ONE es una herramienta de gestion operativa, no software contable, y no sustituye la asesoria de tu contador.
        Las causaciones, retenciones, declaraciones y obligaciones tributarias son responsabilidad del profesional contable del cliente.
      </p>
    </div>
  )
}
