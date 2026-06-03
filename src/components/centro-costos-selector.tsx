'use client'

// ============================================================
// CentroCostosSelector — selector segmentado de centro de costos
// ============================================================
//
// Componente reutilizable. Lo usa /nuevo/gasto y eventualmente el quick-add
// inline de /movimientos.
//
// Diseño aprobado por Mauricio + Noor + Vera + Hana:
//   - Segmented control horizontal con 3 opciones primarias:
//     [Directo a negocio] [ONE] [Clarity]
//   - Link discreto "es mixto" abre modal con presets + custom
//   - Pre-asigna valor sugerido con badge cuando viene una propuesta confianza ≥0.7
//   - Si elige "Directo a negocio", muestra selector de negocio
//
// Tokens MeTRIK canónicos (verde #10B981, gris #6B7280, borde #E5E7EB).
// ============================================================

import { useState } from 'react'
import { Briefcase, Building2, Layers, Sparkles, X } from 'lucide-react'
import type { CentroCostos, OrigenAsignacion } from '@/lib/actions/centro-costos-asignar'

export interface NegocioOption {
  id: string
  nombre: string
  codigo: string
}

export type SplitJson = Record<string, number>

export interface CentroCostosValue {
  centro: CentroCostos
  /** Solo si centro = 'directa_negocio'. */
  negocio_id?: string | null
  /** Solo si centro = 'mixta'. Suma debe = 1.0. */
  split?: SplitJson
}

interface Props {
  /** Negocios activos del workspace (mostrar al elegir directa_negocio). */
  negocios: NegocioOption[]
  /** Valor controlado. */
  value: CentroCostosValue | null
  onChange: (v: CentroCostosValue) => void
  /**
   * Si viene del motor con confianza ≥0.7, pre-rellenamos y mostramos badge.
   * El usuario puede cambiarlo (eso convierte el origen a 'manual' al guardar).
   */
  sugerencia?: {
    centro: CentroCostos
    origen: OrigenAsignacion
    confianza: number
    sugerido_negocio_id?: string | null
  } | null
}

const OPCIONES_PRIMARIAS: Array<{
  centro: CentroCostos
  label: string
  sub: string
  icon: typeof Briefcase
}> = [
  { centro: 'directa_negocio', label: 'A un negocio', sub: 'Directo', icon: Briefcase },
  { centro: 'distribuible_one', label: 'ONE', sub: 'Producto', icon: Building2 },
  { centro: 'distribuible_clarity', label: 'Clarity', sub: 'Consulting', icon: Layers },
]

const PRESETS_MIXTA: Array<{ label: string; split: SplitJson }> = [
  { label: '50% ONE / 50% Clarity', split: { distribuible_one: 0.5, distribuible_clarity: 0.5 } },
  { label: '70% ONE / 30% Clarity', split: { distribuible_one: 0.7, distribuible_clarity: 0.3 } },
  { label: '30% ONE / 70% Clarity', split: { distribuible_one: 0.3, distribuible_clarity: 0.7 } },
]

export default function CentroCostosSelector({
  negocios,
  value,
  onChange,
  sugerencia,
}: Props) {
  const [showMixtaModal, setShowMixtaModal] = useState(false)

  // El form (nuevo-gasto-form) pre-aplica la sugerencia ≥0.7 al setear `value`.
  // El badge se muestra cuando el valor actual coincide con la sugerencia vigente.
  const centroActual = value?.centro ?? null
  const mostrandoSugerenciaBadge =
    sugerencia !== undefined &&
    sugerencia !== null &&
    sugerencia.confianza >= 0.7 &&
    value?.centro === sugerencia.centro

  const handleSelectPrimaria = (centro: CentroCostos) => {
    if (centro === 'directa_negocio') {
      // Mantener negocio sugerido si coincide, sino limpiar
      const negId =
        sugerencia?.centro === 'directa_negocio'
          ? sugerencia.sugerido_negocio_id
          : null
      onChange({ centro, negocio_id: negId ?? null })
    } else {
      onChange({ centro })
    }
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[#6B7280]">
        Centro de costos
      </label>

      {/* Segmented control */}
      <div className="grid grid-cols-3 gap-1.5">
        {OPCIONES_PRIMARIAS.map((opt) => {
          const active = centroActual === opt.centro
          const Icon = opt.icon
          return (
            <button
              key={opt.centro}
              type="button"
              onClick={() => handleSelectPrimaria(opt.centro)}
              className={`rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                active
                  ? 'border-[#10B981] bg-[#10B981]/10 text-[#059669]'
                  : 'border-[#E5E7EB] bg-background text-[#6B7280] hover:border-[#10B981]/50'
              }`}
            >
              <div className="flex items-center justify-center gap-1">
                <Icon className="h-3 w-3" />
                <span className="leading-tight">{opt.label}</span>
              </div>
              <div className="mt-0.5 text-[10px] opacity-70">{opt.sub}</div>
            </button>
          )
        })}
      </div>

      {/* Sugerencia badge */}
      {mostrandoSugerenciaBadge && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[#059669]">
          <Sparkles className="h-3 w-3" />
          <span>
            Sugerido — tap para cambiar
          </span>
        </div>
      )}

      {/* Link discreto "es mixto" */}
      <button
        type="button"
        onClick={() => setShowMixtaModal(true)}
        className={`mt-2 text-[11px] underline-offset-2 hover:underline ${
          centroActual === 'mixta'
            ? 'text-[#059669] font-medium'
            : 'text-[#6B7280]'
        }`}
      >
        {centroActual === 'mixta'
          ? `Mixto: ${formatSplitBreve(value?.split)}`
          : 'Es mixto — sirve a más de uno'}
      </button>

      {/* Selector negocio cuando directa_negocio */}
      {centroActual === 'directa_negocio' && (
        <div className="mt-3">
          <label className="mb-1 block text-[10px] font-medium text-[#6B7280]">
            ¿A qué negocio?
          </label>
          <select
            value={value?.negocio_id ?? ''}
            onChange={(e) =>
              onChange({
                centro: 'directa_negocio',
                negocio_id: e.target.value || null,
              })
            }
            className="w-full rounded-md border border-[#E5E7EB] bg-background px-3 py-2 text-sm"
          >
            <option value="">Selecciona un negocio…</option>
            {negocios.map((n) => (
              <option key={n.id} value={n.id}>
                {n.codigo ? `${n.codigo} — ${n.nombre}` : n.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Modal mixta */}
      {showMixtaModal && (
        <MixtaModal
          negocios={negocios}
          currentSplit={value?.centro === 'mixta' ? value.split : undefined}
          onClose={() => setShowMixtaModal(false)}
          onConfirm={(split) => {
            onChange({ centro: 'mixta', split })
            setShowMixtaModal(false)
          }}
        />
      )}
    </div>
  )
}

// ── Modal mixta con presets + custom ────────────────────────

function MixtaModal({
  negocios,
  currentSplit,
  onClose,
  onConfirm,
}: {
  negocios: NegocioOption[]
  currentSplit?: SplitJson
  onClose: () => void
  onConfirm: (split: SplitJson) => void
}) {
  const [modo, setModo] = useState<'preset' | 'custom'>('preset')
  const [pctOne, setPctOne] = useState<string>(() => {
    if (currentSplit?.distribuible_one !== undefined) {
      return String(Math.round(currentSplit.distribuible_one * 100))
    }
    return '50'
  })
  const [pctClarity, setPctClarity] = useState<string>(() => {
    if (currentSplit?.distribuible_clarity !== undefined) {
      return String(Math.round(currentSplit.distribuible_clarity * 100))
    }
    return '50'
  })

  const handlePctOneChange = (v: string) => {
    setPctOne(v)
    const n = parseFloat(v)
    if (!isNaN(n) && n >= 0 && n <= 100) {
      setPctClarity(String(100 - n))
    }
  }

  const handlePctClarityChange = (v: string) => {
    setPctClarity(v)
    const n = parseFloat(v)
    if (!isNaN(n) && n >= 0 && n <= 100) {
      setPctOne(String(100 - n))
    }
  }

  const handleCustomConfirm = () => {
    const o = parseFloat(pctOne)
    const c = parseFloat(pctClarity)
    if (isNaN(o) || isNaN(c) || o < 0 || c < 0 || Math.abs(o + c - 100) > 0.5) return
    onConfirm({
      distribuible_one: o / 100,
      distribuible_clarity: c / 100,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-xl bg-background p-5 shadow-xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#1A1A1A]">Gasto mixto</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#6B7280] hover:bg-[#F5F4F2]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-[11px] text-[#6B7280]">
          Distribuye el gasto entre centros. Los porcentajes deben sumar 100%.
        </p>

        {/* Toggle preset/custom */}
        <div className="mb-3 flex gap-1.5">
          <button
            type="button"
            onClick={() => setModo('preset')}
            className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${
              modo === 'preset'
                ? 'border-[#10B981] bg-[#10B981]/10 text-[#059669]'
                : 'border-[#E5E7EB] text-[#6B7280]'
            }`}
          >
            Presets
          </button>
          <button
            type="button"
            onClick={() => setModo('custom')}
            className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${
              modo === 'custom'
                ? 'border-[#10B981] bg-[#10B981]/10 text-[#059669]'
                : 'border-[#E5E7EB] text-[#6B7280]'
            }`}
          >
            Personalizado
          </button>
        </div>

        {modo === 'preset' ? (
          <div className="space-y-1.5">
            {PRESETS_MIXTA.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => onConfirm(p.split)}
                className="w-full rounded-md border border-[#E5E7EB] bg-background px-3 py-2.5 text-left text-sm hover:border-[#10B981]/50"
              >
                {p.label}
              </button>
            ))}
            <p className="pt-2 text-[10px] text-[#6B7280]">
              ¿Necesitas split con un negocio específico? Usa Personalizado.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[10px] font-medium text-[#6B7280]">
                % a ONE
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={pctOne}
                  onChange={(e) => handlePctOneChange(e.target.value)}
                  className="w-full rounded-md border border-[#E5E7EB] bg-background py-2 pl-3 pr-8 text-sm"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#6B7280]">
                  %
                </span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium text-[#6B7280]">
                % a Clarity
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={pctClarity}
                  onChange={(e) => handlePctClarityChange(e.target.value)}
                  className="w-full rounded-md border border-[#E5E7EB] bg-background py-2 pl-3 pr-8 text-sm"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#6B7280]">
                  %
                </span>
              </div>
            </div>
            <p className="text-[10px] text-[#6B7280]">
              Al cambiar uno, el complemento se autoajusta. Para incluir un negocio
              específico en el split (ej: 60% ONE + 40% a un negocio), edita el JSON
              tras guardar — UI completa de splits con negocios viene en iteración siguiente.
            </p>
            <button
              type="button"
              onClick={handleCustomConfirm}
              className="w-full rounded-md bg-[#10B981] py-2 text-sm font-medium text-white hover:bg-[#059669]"
            >
              Guardar split
            </button>
          </div>
        )}

        {/* Lista negocios disponibles (informativo) */}
        {modo === 'custom' && negocios.length > 0 && (
          <details className="mt-3 text-[10px] text-[#6B7280]">
            <summary className="cursor-pointer">
              Ver {negocios.length} negocio(s) disponibles
            </summary>
            <ul className="mt-1 max-h-32 overflow-y-auto rounded border border-[#E5E7EB] p-2">
              {negocios.map((n) => (
                <li key={n.id} className="py-0.5">
                  {n.codigo ? `${n.codigo} — ` : ''}
                  {n.nombre}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}

function formatSplitBreve(split: SplitJson | undefined): string {
  if (!split) return 'sin desglose'
  const partes: string[] = []
  for (const [k, v] of Object.entries(split)) {
    const pct = Math.round(v * 100)
    const label =
      k === 'distribuible_one'
        ? 'ONE'
        : k === 'distribuible_clarity'
        ? 'Clarity'
        : k.startsWith('negocio:')
        ? 'negocio'
        : k
    partes.push(`${pct}% ${label}`)
  }
  return partes.join(' / ')
}
