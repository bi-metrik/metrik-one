/**
 * Sprint 12 — D70: CSV export utility
 * CSV siempre exportable en todos los planes
 *
 * Client-side CSV generation with download
 */

interface CSVColumn<T> {
  header: string
  accessor: (row: T) => string | number | null | undefined
}

export function generateCSV<T>(
  data: T[],
  columns: CSVColumn<T>[],
): string {
  const headers = columns.map(c => c.header).join(',')
  const rows = data.map(row =>
    columns
      .map(col => {
        const val = col.accessor(row)
        if (val === null || val === undefined) return ''
        const str = String(val)
        // Escape double quotes and wrap in quotes if needed
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      })
      .join(',')
  )
  return [headers, ...rows].join('\n')
}

export function downloadCSV(csv: string, filename: string) {
  // Add BOM for Excel compatibility with UTF-8
  const BOM = '\uFEFF'
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', `${filename}.csv`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// ── Pre-built export configs ─────────────────────────

export const EXPORT_CONFIGS = {
  expenses: {
    filename: 'gastos',
    columns: [
      { header: 'Fecha', accessor: (r: Record<string, unknown>) => r.expense_date as string },
      { header: 'Descripción', accessor: (r: Record<string, unknown>) => r.description as string },
      { header: 'Categoría', accessor: (r: Record<string, unknown>) => r.categoryName as string },
      { header: 'Monto', accessor: (r: Record<string, unknown>) => r.amount as number },
      { header: 'Proyecto', accessor: (r: Record<string, unknown>) => r.projectName as string },
      { header: 'Rework', accessor: (r: Record<string, unknown>) => (r.is_rework ? 'Sí' : 'No') },
    ],
  },
  projects: {
    filename: 'proyectos',
    columns: [
      { header: 'Nombre', accessor: (r: Record<string, unknown>) => r.name as string },
      { header: 'Cliente', accessor: (r: Record<string, unknown>) => r.clientName as string },
      { header: 'Estado', accessor: (r: Record<string, unknown>) => r.status as string },
      { header: 'Presupuesto', accessor: (r: Record<string, unknown>) => r.approved_budget as number },
      { header: 'Costo real', accessor: (r: Record<string, unknown>) => r.actual_cost as number },
      { header: 'Margen real %', accessor: (r: Record<string, unknown>) => r.actual_margin_pct as number },
      { header: 'Inicio', accessor: (r: Record<string, unknown>) => r.start_date as string },
      { header: 'Fin estimado', accessor: (r: Record<string, unknown>) => r.estimated_end_date as string },
      { header: 'Cerrado', accessor: (r: Record<string, unknown>) => r.closed_at as string },
    ],
  },
  pipeline: {
    filename: 'pipeline',
    columns: [
      { header: 'Nombre', accessor: (r: Record<string, unknown>) => r.name as string },
      { header: 'Cliente', accessor: (r: Record<string, unknown>) => r.clientName as string },
      { header: 'Etapa', accessor: (r: Record<string, unknown>) => r.stage as string },
      { header: 'Valor estimado', accessor: (r: Record<string, unknown>) => r.estimated_value as number },
      { header: 'Probabilidad %', accessor: (r: Record<string, unknown>) => r.probability as number },
      { header: 'Creado', accessor: (r: Record<string, unknown>) => r.created_at as string },
    ],
  },
  invoices: {
    filename: 'cobros',
    columns: [
      { header: 'Concepto', accessor: (r: Record<string, unknown>) => r.concept as string },
      { header: 'Monto bruto', accessor: (r: Record<string, unknown>) => r.gross_amount as number },
      { header: 'Estado', accessor: (r: Record<string, unknown>) => r.status as string },
      { header: 'Vencimiento', accessor: (r: Record<string, unknown>) => r.due_date as string },
      { header: 'Creado', accessor: (r: Record<string, unknown>) => r.created_at as string },
    ],
  },
} as const
