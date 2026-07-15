'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, Check, FileText, AlertTriangle } from 'lucide-react'
import { marcarBloqueCompleto } from '../../negocio-v2-actions'
import type { FacturaDraft } from '../../negocio-v2-actions'

// Bloque de facturación Siigo-ready. Autopobla los datos del cliente ya
// capturados en el expediente (RUT + contacto) + el valor (honorario), para
// copiarlos a Siigo. Con opción de override manual (facturar a nombre de otro).
// El mismo esquema de campos es el contrato que consumirá la API de Siigo.

const formatCOP = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

type CampoKey =
  | 'tipo_identificacion'
  | 'numero_identificacion'
  | 'dv'
  | 'nombre'
  | 'direccion'
  | 'ciudad'
  | 'email'
  | 'telefono'

const CAMPOS_CLIENTE: { key: CampoKey; label: string }[] = [
  { key: 'tipo_identificacion', label: 'Tipo identificación' },
  { key: 'numero_identificacion', label: 'Número identificación' },
  { key: 'dv', label: 'DV' },
  { key: 'nombre', label: 'Nombre / Razón social' },
  { key: 'direccion', label: 'Dirección' },
  { key: 'ciudad', label: 'Ciudad' },
  { key: 'email', label: 'Email' },
  { key: 'telefono', label: 'Teléfono' },
]

interface Props {
  negocioBloqueId: string
  instancia: { id: string; completado: boolean; data: Record<string, unknown> | null } | null
  modo: 'editable' | 'visible'
  draft: FacturaDraft | null
  configExtra: { label?: string; descripcion?: string; iva_pct?: number }
}

export default function BloqueFacturacion({ negocioBloqueId, instancia, modo, draft, configExtra }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [copiado, setCopiado] = useState(false)

  const data = (instancia?.data ?? {}) as Record<string, unknown>
  const readonly = modo === 'visible' || instancia?.completado === true

  const descripcion = configExtra.descripcion ?? 'Incentivos tributarios UPME'
  const ivaPct = configExtra.iva_pct ?? 19

  // Override manual (facturar a nombre de otro). Arranca del valor persistido.
  const [facturarATercero, setFacturarATercero] = useState<boolean>(data.facturar_a_tercero === true)
  const [override, setOverride] = useState<Record<string, string>>(
    (data.override as Record<string, string> | undefined) ?? {},
  )
  const [numeroFactura, setNumeroFactura] = useState<string>((data.numero_factura_siigo as string) ?? '')
  const [fecha, setFecha] = useState<string>((data.fecha_factura as string) ?? '')

  // Valor efectivo de un campo: si se factura a un tercero, gana el override; si
  // no, el autopoblado del draft.
  const val = (key: CampoKey): string => {
    if (facturarATercero) return override[key] ?? (draft?.[key] != null ? String(draft?.[key]) : '')
    return draft?.[key] != null ? String(draft?.[key]) : ''
  }

  const valorBruto = useMemo(() => {
    if (facturarATercero && override.valor_bruto != null && override.valor_bruto !== '') {
      const n = Number(String(override.valor_bruto).replace(/[^\d.-]/g, ''))
      return Number.isFinite(n) ? n : 0
    }
    return draft?.valor_bruto ?? 0
  }, [facturarATercero, override.valor_bruto, draft?.valor_bruto])

  const total = Math.round(valorBruto * (1 + ivaPct / 100))
  const emailFalta = !val('email').trim()

  const setOv = (key: string, value: string) => setOverride(prev => ({ ...prev, [key]: value }))

  const textoParaSiigo = (): string => {
    const linesCliente = CAMPOS_CLIENTE.map(c => `${c.label}: ${val(c.key) || '-'}`)
    return [
      ...linesCliente,
      '---',
      `Producto: ${descripcion}`,
      `Cantidad: 1`,
      `Valor bruto: ${formatCOP(valorBruto)}`,
      `IVA ${ivaPct}%: ${formatCOP(total - valorBruto)}`,
      `Total: ${formatCOP(total)}`,
    ].join('\n')
  }

  const handleCopiar = async () => {
    try {
      await navigator.clipboard.writeText(textoParaSiigo())
      setCopiado(true)
      toast.success('Campos copiados para Siigo')
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  const handleMarcarFacturado = () => {
    if (!numeroFactura.trim() || !fecha) {
      toast.error('Ingresa el número de factura de Siigo y la fecha')
      return
    }
    if (emailFalta) {
      toast.error('Falta el email del cliente para facturar')
      return
    }
    startTransition(async () => {
      const res = await marcarBloqueCompleto(negocioBloqueId, {
        numero_factura_siigo: numeroFactura.trim(),
        fecha_factura: fecha,
        facturar_a_tercero: facturarATercero,
        override: facturarATercero ? override : {},
      })
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Factura registrada')
        router.refresh()
      }
    })
  }

  // ── Modo solo lectura (etapa completada / heredada) ────────────────────────
  if (readonly) {
    return (
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-[#1A1A1A] font-medium">
          <FileText className="h-4 w-4 text-[#10B981]" />
          {configExtra.label ?? 'Facturación'}
        </div>
        {instancia?.completado && (
          <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3 space-y-1 text-xs text-[#6B7280]">
            <div><span className="text-[#1A1A1A] font-medium">Factura Siigo:</span> {(data.numero_factura_siigo as string) || '-'}</div>
            <div><span className="text-[#1A1A1A] font-medium">Fecha:</span> {(data.fecha_factura as string) || '-'}</div>
            <div><span className="text-[#1A1A1A] font-medium">Cliente:</span> {val('nombre') || '-'}</div>
            <div><span className="text-[#1A1A1A] font-medium">Total:</span> {formatCOP(total)}</div>
          </div>
        )}
      </div>
    )
  }

  // ── Modo editable ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[#1A1A1A] font-medium">
          <FileText className="h-4 w-4 text-[#10B981]" />
          {configExtra.label ?? 'Factura para Siigo'}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[#6B7280] cursor-pointer">
          <input
            type="checkbox"
            checked={facturarATercero}
            onChange={e => {
              const on = e.target.checked
              setFacturarATercero(on)
              // Al activar, sembrar el override con los valores autopoblados para
              // que el usuario ajuste solo lo que cambia.
              if (on && Object.keys(override).length === 0) {
                const seed: Record<string, string> = {}
                for (const c of CAMPOS_CLIENTE) seed[c.key] = draft?.[c.key] != null ? String(draft?.[c.key]) : ''
                seed.valor_bruto = draft?.valor_bruto != null ? String(draft.valor_bruto) : ''
                setOverride(seed)
              }
            }}
            className="accent-[#10B981]"
          />
          Facturar a nombre de otro
        </label>
      </div>

      {emailFalta && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Falta el email del cliente. {facturarATercero ? 'Ingrésalo abajo.' : 'Cárgalo en el contacto o factura a nombre de otro.'}
        </div>
      )}

      {/* Datos del cliente */}
      <div className="grid grid-cols-2 gap-2">
        {CAMPOS_CLIENTE.map(c => (
          <div key={c.key} className={c.key === 'nombre' || c.key === 'direccion' ? 'col-span-2' : ''}>
            <label className="block text-[10px] uppercase tracking-wide text-[#9CA3AF] mb-0.5">{c.label}</label>
            {facturarATercero ? (
              <input
                value={override[c.key] ?? ''}
                onChange={e => setOv(c.key, e.target.value)}
                className="w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 text-sm focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15"
              />
            ) : (
              <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-2 py-1.5 text-sm text-[#1A1A1A] min-h-[34px]">
                {val(c.key) || <span className="text-[#9CA3AF]">-</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Ítem + valores */}
      <div className="rounded-md border border-[#E5E7EB] p-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-[#6B7280]">{descripcion} (x1)</span>
          {facturarATercero ? (
            <input
              value={override.valor_bruto ?? ''}
              onChange={e => setOv('valor_bruto', e.target.value)}
              placeholder="Valor bruto"
              className="w-28 rounded border border-[#E5E7EB] px-2 py-0.5 text-right text-sm focus:border-[#10B981] focus:outline-none"
            />
          ) : (
            <span className="text-[#1A1A1A] font-medium">{formatCOP(valorBruto)}</span>
          )}
        </div>
        <div className="flex justify-between text-xs text-[#6B7280]">
          <span>IVA {ivaPct}%</span>
          <span>{formatCOP(total - valorBruto)}</span>
        </div>
        <div className="flex justify-between text-sm font-semibold text-[#1A1A1A] border-t border-[#E5E7EB] pt-1.5">
          <span>Total</span>
          <span>{formatCOP(total)}</span>
        </div>
      </div>

      <button
        onClick={handleCopiar}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-[#1A1A1A] hover:bg-accent"
      >
        {copiado ? <Check className="h-3.5 w-3.5 text-[#10B981]" /> : <Copy className="h-3.5 w-3.5" />}
        {copiado ? 'Copiado' : 'Copiar campos'}
      </button>

      {/* Retorno: número de factura Siigo + fecha (cierra el negocio) */}
      <div className="border-t border-[#E5E7EB] pt-3 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-[#9CA3AF] mb-0.5">N° factura Siigo</label>
          <input
            value={numeroFactura}
            onChange={e => setNumeroFactura(e.target.value)}
            placeholder="SOE ..."
            className="w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 text-sm focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-[#9CA3AF] mb-0.5">Fecha</label>
          <input
            type="date"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
            className="w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 text-sm focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15"
          />
        </div>
      </div>

      <button
        onClick={handleMarcarFacturado}
        disabled={isPending}
        className="w-full rounded-lg bg-[#10B981] py-2 text-sm font-medium text-white hover:bg-[#059669] disabled:opacity-50"
      >
        {isPending ? 'Guardando...' : 'Registrar factura'}
      </button>
    </div>
  )
}
