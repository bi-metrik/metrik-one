'use client'

interface Column {
  key: string
  label: string
  align?: 'left' | 'right'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- valor del row es arbitrario en el punto de consumo
  render?: (value: any) => React.ReactNode
}

interface MiniTableProps {
  columns: Column[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows son estructurados en el call-site
  data: Record<string, any>[]
  emptyMessage?: string
}

export function MiniTable({ columns, data, emptyMessage = 'Sin datos' }: MiniTableProps) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400 py-4 text-center">{emptyMessage}</p>
  }

  return (
    <div className="overflow-x-auto -mx-6 px-6">
      <table className="w-full min-w-[400px]">
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                className={`pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.map((row, i) => (
            <tr key={i}>
              {columns.map(col => (
                <td
                  key={col.key}
                  className={`py-2.5 text-sm ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  } ${col.key === columns[0].key ? 'font-medium text-gray-900' : 'text-gray-500'}`}
                >
                  {col.render ? col.render(row[col.key]) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
