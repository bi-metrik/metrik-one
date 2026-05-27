'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

type Option = { value: string; label: string }

interface Props {
  categoria: string
  nivel: string
  estado: string
  factor: string
}

const CATEGORIA_OPTIONS: Option[] = [
  { value: 'todos', label: 'Todas las categorias' },
  { value: 'LA', label: 'LA' },
  { value: 'FT', label: 'FT' },
  { value: 'FPADM', label: 'FPADM' },
  { value: 'PTEE', label: 'PTEE' },
]

const NIVEL_OPTIONS: Option[] = [
  { value: 'todos', label: 'Todos los niveles' },
  { value: 'EXTREMO', label: 'Extremo' },
  { value: 'ALTO', label: 'Alto' },
  { value: 'MODERADO', label: 'Moderado' },
  { value: 'BAJO', label: 'Bajo' },
]

const ESTADO_OPTIONS: Option[] = [
  { value: 'todos', label: 'Todos los estados' },
  { value: 'ABIERTO', label: 'Abierto' },
  { value: 'BAJO_CONTROL', label: 'Bajo control' },
  { value: 'MONITOREADO', label: 'Monitoreado' },
  { value: 'MITIGADO', label: 'Mitigado' },
  { value: 'REPORTADO', label: 'Reportado' },
  { value: 'CERRADO', label: 'Cerrado' },
]

const FACTOR_OPTIONS: Option[] = [
  { value: 'todos', label: 'Todos los factores' },
  { value: 'clientes', label: 'Clientes' },
  { value: 'proveedores', label: 'Proveedores' },
  { value: 'empleados', label: 'Empleados' },
  { value: 'canales', label: 'Canales' },
  { value: 'jurisdicciones', label: 'Jurisdicciones' },
  { value: 'productos', label: 'Productos' },
  { value: 'operaciones', label: 'Operaciones' },
]

export default function RiesgosFilters({ categoria, nivel, estado, factor }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function navigateWith(key: string, value: string) {
    const current = { categoria, nivel, estado, factor }
    const updated = { ...current, [key]: value }
    const p = new URLSearchParams()
    Object.entries(updated).forEach(([k, v]) => {
      if (v !== 'todos') p.set(k, v)
    })
    const qs = p.toString()
    const url = `/riesgos${qs ? `?${qs}` : ''}`
    startTransition(() => router.push(url))
  }

  const hasActiveFilter =
    categoria !== 'todos' || nivel !== 'todos' || estado !== 'todos' || factor !== 'todos'

  return (
    <div className="flex flex-wrap items-end gap-3">
      <FilterDropdown
        label="Categoria"
        value={categoria}
        options={CATEGORIA_OPTIONS}
        onChange={v => navigateWith('categoria', v)}
        disabled={isPending}
      />
      <FilterDropdown
        label="Nivel"
        value={nivel}
        options={NIVEL_OPTIONS}
        onChange={v => navigateWith('nivel', v)}
        disabled={isPending}
      />
      <FilterDropdown
        label="Estado"
        value={estado}
        options={ESTADO_OPTIONS}
        onChange={v => navigateWith('estado', v)}
        disabled={isPending}
      />
      <FilterDropdown
        label="Factor"
        value={factor}
        options={FACTOR_OPTIONS}
        onChange={v => navigateWith('factor', v)}
        disabled={isPending}
      />
      {hasActiveFilter && (
        <button
          type="button"
          onClick={() => startTransition(() => router.push('/riesgos'))}
          disabled={isPending}
          className="text-xs font-medium text-[#10B981] hover:text-[#059669] transition-colors disabled:opacity-50 pb-2"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  )
}

function FilterDropdown({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-medium uppercase tracking-wider text-[#6B7280]">
        {label}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 pr-8 text-sm text-[#1A1A1A] shadow-sm transition-colors hover:border-[#10B981] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
