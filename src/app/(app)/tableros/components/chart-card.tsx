'use client'

interface ChartCardProps {
  title: string
  subtitle?: string
  children: React.ReactNode
  className?: string
  accentColor?: string
}

export function ChartCard({ title, subtitle, children, className = '', accentColor }: ChartCardProps) {
  return (
    // p-4 en movil: con p-6 la tarjeta se come 48px de los ~390px de un telefono y el
    // contenido ancho (tablas, graficos) pierde una columna entera.
    <div
      className={`rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6 ${className}`}
      style={accentColor ? { borderTop: `2px solid ${accentColor}` } : undefined}
    >
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}
