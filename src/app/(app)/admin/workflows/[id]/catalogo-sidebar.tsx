'use client'

import { useState } from 'react'

interface BloqueCatalogo {
  nombre: string
  tipo: string
  icono: string
  categoria: 'editable' | 'readonly' | 'especial'
  descripcion: string
  puede_gate: boolean
}

const BLOQUES: BloqueCatalogo[] = [
  { nombre: 'Datos',              tipo: 'BloqueDatos',              icono: '📋', categoria: 'editable', puede_gate: true,  descripcion: 'Campos flexibles: texto, numero, fecha, toggle, select, imagen. Auto-guardado.' },
  { nombre: 'Documento',          tipo: 'BloqueDocumento',          icono: '📄', categoria: 'editable', puede_gate: true,  descripcion: 'Upload de archivos con extraccion automatica AI (RUT, CC, etc). Vive en Drive.' },
  { nombre: 'Cotizacion',         tipo: 'BloqueCotizacion',         icono: '📝', categoria: 'editable', puede_gate: true,  descripcion: 'Propuesta economica con estados: borrador → enviada → aceptada. PDF descargable.' },
  { nombre: 'Aprobacion',         tipo: 'BloqueAprobacion',         icono: '✅', categoria: 'editable', puede_gate: true,  descripcion: 'Decision aprobado/rechazado con comentario registrado en historial.' },
  { nombre: 'Checklist',          tipo: 'BloqueChecklist',          icono: '☑️', categoria: 'editable', puede_gate: true,  descripcion: 'Tareas predefinidas. Completar todos = firma del usuario.' },
  { nombre: 'Cronograma',         tipo: 'BloqueCronograma',         icono: '📅', categoria: 'editable', puede_gate: false, descripcion: 'Fechas, hitos y responsables por actividad. Alinea expectativas.' },
  { nombre: 'Cobros',             tipo: 'BloqueCobros',             icono: '💰', categoria: 'editable', puede_gate: false, descripcion: 'Cartera: anticipos, saldos, pagos con estados de causacion.' },
  { nombre: 'Accion',             tipo: 'BloqueAccion',             icono: '⚡', categoria: 'especial', puede_gate: false, descripcion: 'Boton que dispara automatizacion (skill, API, trigger).' },
  { nombre: 'Ejecucion',          tipo: 'BloqueEjecucion',          icono: '⚙️', categoria: 'readonly', puede_gate: false, descripcion: 'Presupuesto vs ejecutado por categoria con umbrales visuales (70/90/100%).' },
  { nombre: 'Historial',          tipo: 'BloqueHistorial',          icono: '📜', categoria: 'readonly', puede_gate: false, descripcion: 'Registro completo de gastos, horas y cobros del negocio con tabs.' },
  { nombre: 'Resumen financiero', tipo: 'BloqueResumenFinanciero',  icono: '📊', categoria: 'readonly', puede_gate: false, descripcion: 'Dashboard tiempo real: ejecutado, cobrado, por pagar, por cobrar.' },
  { nombre: 'Documentos',         tipo: 'BloqueDocumentos',         icono: '📑', categoria: 'readonly', puede_gate: false, descripcion: 'Listado de documentos generados por el workflow con preview.' },
  { nombre: 'Drive',              tipo: 'BloqueDrive',              icono: '☁️', categoria: 'readonly', puede_gate: false, descripcion: 'Estado de sync con carpeta Drive del cliente via Google Workspace.' },
]

const CAT_LABELS = {
  editable: { label: 'Interactivos',   desc: 'El usuario completa informacion' },
  especial: { label: 'Acciones',       desc: 'Disparan automatizaciones' },
  readonly: { label: 'Visualizacion',  desc: 'Solo lectura, datos en vivo' },
}

export default function CatalogoSidebar() {
  const [open, setOpen] = useState(false)

  const grupos = (['editable', 'especial', 'readonly'] as const).map(cat => ({
    key: cat,
    ...CAT_LABELS[cat],
    items: BLOQUES.filter(b => b.categoria === cat),
  }))

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-[#10B981] hover:text-[#10B981]"
      >
        📚 Catalogo de bloques
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setOpen(false)}>
          <div className="fixed inset-0 bg-black/25" />
          <div
            className="relative h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-3">
              <div>
                <h2 className="text-sm font-bold text-[#1A1A1A]">Catalogo de bloques</h2>
                <p className="text-[11px] text-gray-400">Componentes reutilizables en todos los workflows</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-500 hover:bg-gray-50"
                aria-label="Cerrar"
              >
                ×
              </button>
            </header>

            <div className="space-y-6 p-5">
              {grupos.map(g => (
                <section key={g.key}>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{g.label}</p>
                  <p className="mb-3 text-[11px] text-gray-500">{g.desc}</p>
                  <ul className="space-y-2">
                    {g.items.map(b => (
                      <li key={b.tipo} className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="flex items-start gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-50 text-base">
                            {b.icono}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[13px] font-semibold text-[#1A1A1A]">{b.nombre}</p>
                              {b.puede_gate && (
                                <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-red-600">Gate</span>
                              )}
                            </div>
                            <p className="text-[10px] font-mono text-gray-400">{b.tipo}</p>
                            <p className="mt-1 text-[11px] leading-snug text-gray-600">{b.descripcion}</p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
