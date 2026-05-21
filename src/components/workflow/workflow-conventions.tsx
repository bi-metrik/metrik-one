'use client'

/**
 * <WorkflowConventions>
 *
 * Leyenda visual colapsable con las convenciones del WorkflowDiagram:
 * stages, ramas laterales, decisiones, bloques, gates, badges y nodos
 * terminales. Mismo componente sirve a vista cliente (simplified) y a
 * vista admin (detailed) — sin variantes por modo.
 *
 * Default colapsada. Click en el header expande / contrae.
 */

import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  Eye,
  GitBranch,
} from 'lucide-react'

interface Item {
  label: string
  description: string
  sample: React.ReactNode
}

function Sample({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-8 w-10 shrink-0 items-center justify-center">
      {children}
    </div>
  )
}

function StageBadge({
  color,
  label,
}: {
  color: string
  label: string
}) {
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold"
      style={{
        backgroundColor: `${color}1A`,
        color,
        border: `1px solid ${color}40`,
      }}
    >
      {label}
    </span>
  )
}

const ITEMS: Item[] = [
  // ── Etapas y stages ─────────────────────────────────────────────────
  {
    label: 'Etapa Venta',
    description: 'Antes del cierre comercial.',
    sample: (
      <Sample>
        <StageBadge color="#10B981" label="Venta" />
      </Sample>
    ),
  },
  {
    label: 'Etapa Ejecución',
    description: 'Después del cierre, en operación.',
    sample: (
      <Sample>
        <StageBadge color="#F59E0B" label="Ejecución" />
      </Sample>
    ),
  },
  {
    label: 'Etapa Cobro',
    description: 'Gestión de pagos.',
    sample: (
      <Sample>
        <StageBadge color="#3B82F6" label="Cobro" />
      </Sample>
    ),
  },
  {
    label: 'Rama lateral',
    description: 'Etapa condicional, solo si se cumple una condición.',
    sample: (
      <Sample>
        <div
          className="flex h-7 w-9 items-center justify-center rounded-md border-2 bg-white"
          style={{ borderColor: '#10B981' }}
        >
          <span className="text-[8px] font-semibold text-[#10B981]">Rama</span>
        </div>
      </Sample>
    ),
  },
  // ── Decisiones ──────────────────────────────────────────────────────
  {
    label: 'Decisión',
    description: 'Punto donde el flujo bifurca según un dato.',
    sample: (
      <Sample>
        <div
          className="flex h-6 w-6 rotate-45 items-center justify-center border-2 bg-white"
          style={{ borderColor: '#1A1A1A' }}
        >
          <span className="-rotate-45 text-[11px] font-bold text-[#1A1A1A]">?</span>
        </div>
      </Sample>
    ),
  },
  {
    label: 'Rama SÍ',
    description: 'Camino cuando se cumple la condición.',
    sample: (
      <Sample>
        <svg width="20" height="28" viewBox="0 0 20 28" fill="none">
          <path
            d="M10 2 L10 22"
            stroke="#10B981"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M5 17 L10 22 L15 17"
            stroke="#10B981"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </Sample>
    ),
  },
  {
    label: 'Rama NO',
    description: 'Camino por defecto.',
    sample: (
      <Sample>
        <svg width="32" height="20" viewBox="0 0 32 20" fill="none">
          <path
            d="M2 10 L26 10"
            stroke="#6B7280"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M21 5 L26 10 L21 15"
            stroke="#6B7280"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </Sample>
    ),
  },
  // ── Bloques ─────────────────────────────────────────────────────────
  {
    label: 'Bloque normal',
    description: 'Captura datos o muestra información.',
    sample: (
      <Sample>
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: '#6B7280' }}
        />
      </Sample>
    ),
  },
  {
    label: 'Gate',
    description: 'Bloquea el avance hasta completarlo.',
    sample: (
      <Sample>
        <div className="flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: '#10B981' }}
          />
          <ShieldCheck className="h-3.5 w-3.5" style={{ color: '#10B981' }} />
        </div>
      </Sample>
    ),
  },
  {
    label: 'Bloque solo lectura',
    description:
      'Muestra información heredada de etapas anteriores. No se edita aquí.',
    sample: (
      <Sample>
        <Eye className="h-3.5 w-3.5" style={{ color: '#6B7280' }} />
      </Sample>
    ),
  },
  {
    label: 'Bloque condicional',
    description:
      'Solo aparece si se cumple una condición de otro bloque (ej: respuesta de un toggle).',
    sample: (
      <Sample>
        <GitBranch className="h-3.5 w-3.5" style={{ color: '#6B7280' }} />
      </Sample>
    ),
  },
  {
    label: 'Tipo de bloque',
    description:
      'Etiqueta gris al extremo derecho. Identifica el tipo técnico del bloque (datos, documento, cotización, cobros, formulario, cronograma, etc.).',
    sample: (
      <Sample>
        <span
          className="rounded-full bg-[#F5F4F2] px-1.5 py-[1px] text-[9px] font-mono uppercase tracking-wider text-[#6B7280]"
        >
          datos
        </span>
      </Sample>
    ),
  },
  {
    label: 'ID del bloque',
    description:
      'Etiqueta negra junto al nombre. 2 letras del tipo + número consecutivo por línea (DA=datos, DC=documento, CT=cotización, CB=cobros, FO=formulario, etc.). Útil para referirse al bloque sin confusión.',
    sample: (
      <Sample>
        <span
          className="rounded-md bg-[#1A1A1A] px-1.5 py-[1px] text-[9px] font-mono font-semibold tracking-wider text-white"
        >
          DC1
        </span>
      </Sample>
    ),
  },
  // ── Badges por etapa ────────────────────────────────────────────────
  {
    label: 'Cantidad abiertos',
    description: 'Negocios activos en esa etapa.',
    sample: (
      <Sample>
        <span
          className="inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            backgroundColor: '#E5E7EB',
            color: '#1A1A1A',
          }}
        >
          7
        </span>
      </Sample>
    ),
  },
  {
    label: 'Vencidos',
    description: 'Negocios que superaron el SLA configurado.',
    sample: (
      <Sample>
        <span
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            backgroundColor: '#FEE2E2',
            color: '#B91C1C',
          }}
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          2
        </span>
      </Sample>
    ),
  },
  // ── Otros elementos ─────────────────────────────────────────────────
  {
    label: 'Cierre del negocio',
    description: 'Fin del flujo.',
    sample: (
      <Sample>
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold text-white"
          style={{ backgroundColor: '#1A1A1A' }}
        >
          Cierre
        </span>
      </Sample>
    ),
  },
  {
    label: 'Numeración',
    description: 'Orden de la etapa.',
    sample: (
      <Sample>
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ backgroundColor: '#10B981' }}
        >
          03
        </span>
      </Sample>
    ),
  },
]

export function WorkflowConventions() {
  const [open, setOpen] = useState(false)

  return (
    <div
      className="mb-4 rounded-xl border"
      style={{ backgroundColor: '#F5F4F2', borderColor: '#E5E7EB' }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[12px] font-semibold text-[#1A1A1A]">
          Convenciones del diagrama
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-[#6B7280]" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[#6B7280]" />
        )}
      </button>
      {open && (
        <div className="border-t px-4 py-4" style={{ borderColor: '#E5E7EB' }}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {ITEMS.map(item => (
              <div key={item.label} className="flex items-start gap-3">
                {item.sample}
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="text-[12px] font-semibold text-[#1A1A1A]">
                    {item.label}
                  </div>
                  <div className="text-[11px] leading-snug text-[#6B7280]">
                    {item.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
