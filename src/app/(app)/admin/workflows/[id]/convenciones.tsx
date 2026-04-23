export default function Convenciones() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Convenciones</p>

      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mt-3 mb-1.5">Fases</p>
      <div className="space-y-1 text-[11px]">
        <LegendItem color="#3b82f6" label="Venta" />
        <LegendItem color="#f59e0b" label="Ejecucion" />
        <LegendItem color="#10B981" label="Cobro" />
      </div>

      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mt-4 mb-1.5">Bloques</p>
      <div className="space-y-1.5 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-l-4 border-gray-200 border-l-red-500 bg-white px-2 py-0.5 text-[10px]">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500"></span>
            Gate
          </span>
          <span className="text-gray-500">obligatorio para avanzar</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-dashed border-gray-300 bg-white px-2 py-0.5 text-[10px] text-gray-400">
            Lectura
          </span>
          <span className="text-gray-500">solo visualizacion</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-[#10B981] bg-[#ecfdf5] px-2 py-0.5 text-[10px] font-semibold text-[#059669]">
            Accion
          </span>
          <span className="text-gray-500">dispara automatizacion</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-2 py-0.5 text-[10px] text-gray-500">
            Placeholder
          </span>
          <span className="text-gray-500">etapa por definir</span>
        </div>
      </div>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
      <span className="text-gray-700">{label}</span>
    </div>
  )
}
