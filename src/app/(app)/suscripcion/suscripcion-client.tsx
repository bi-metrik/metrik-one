'use client'

import { useState } from 'react'
import { CreditCard, FileText, LayoutDashboard, Users } from 'lucide-react'
import { SeccionSustenta, type EstadoSustenta } from './sustenta'
import { UsuariosPanel, type DatosUsuarios } from './usuarios-panel'

export type PestanaSuscripcion = 'resumen' | 'pagos' | 'usuarios' | 'terminos'

interface Props {
  tabInicial: PestanaSuscripcion
  /** La tarjeta de pago, o la aceptación de los Términos si están pendientes. Se pinta en el servidor. */
  principal: React.ReactNode
  licencias: { usados: number; total: number } | null
  terminosResumen: string | null
  /** `oferta`: la tarjeta; `solicitada`: la confirmación que se queda; `null`: nada («Ahora no» vigente). */
  sustenta: EstadoSustenta | null
  pagos: React.ReactNode
  terminos: React.ReactNode
  usuarios: DatosUsuarios
}

const ETIQUETAS: Record<PestanaSuscripcion, string> = {
  resumen: 'Resumen',
  pagos: 'Pagos',
  usuarios: 'Usuarios',
  terminos: 'Términos',
}

const ICONOS: Record<PestanaSuscripcion, React.ReactNode> = {
  resumen: <LayoutDashboard className="h-4 w-4" />,
  pagos: <CreditCard className="h-4 w-4" />,
  usuarios: <Users className="h-4 w-4" />,
  terminos: <FileText className="h-4 w-4" />,
}

export default function SuscripcionClient(p: Props) {
  const [tab, setTab] = useState<PestanaSuscripcion>(p.tabInicial)

  function ir(t: PestanaSuscripcion) {
    setTab(t)
    // La pestaña queda en la URL para volver a ella al recargar, sin pedirle nada al servidor.
    const url = new URL(window.location.href)
    if (t === 'resumen') url.searchParams.delete('tab')
    else url.searchParams.set('tab', t)
    window.history.replaceState(null, '', url.toString())
  }

  return (
    <div className="space-y-5">
      <div role="tablist" data-pestanas-suscripcion className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
        {(Object.keys(ETIQUETAS) as PestanaSuscripcion[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => ir(t)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t ? 'border-acento text-tinta' : 'border-transparent text-tinta-suave hover:text-tinta'
            }`}
          >
            {ICONOS[t]}
            {ETIQUETAS[t]}
          </button>
        ))}
      </div>

      {tab === 'resumen' && (
        <div className="space-y-4" data-pestana="resumen">
          {p.principal}

          {p.licencias && (
            <section data-resumen-licencias className="rounded-lg border border-border bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-tinta">
                  {p.licencias.usados} de {p.licencias.total} usuarios en uso
                </p>
                <button type="button" onClick={() => ir('usuarios')} className="text-sm font-semibold text-acento">
                  Ver usuarios
                </button>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-papel" aria-hidden>
                <div
                  className="h-full rounded-full bg-acento"
                  style={{ width: `${Math.min(100, Math.round((p.licencias.usados / Math.max(1, p.licencias.total)) * 100))}%` }}
                />
              </div>
            </section>
          )}

          {p.terminosResumen && (
            <section data-resumen-terminos className="flex items-center justify-between gap-3 rounded-lg border border-border bg-white p-4">
              <p className="text-sm text-tinta">
                <span className="font-semibold">Términos. </span>
                {p.terminosResumen}
              </p>
              <button type="button" onClick={() => ir('terminos')} className="shrink-0 text-sm font-semibold text-acento">
                Ver constancia
              </button>
            </section>
          )}

          {p.sustenta && <SeccionSustenta inicial={p.sustenta} />}
        </div>
      )}

      {tab === 'pagos' && <div data-pestana="pagos">{p.pagos}</div>}
      {tab === 'usuarios' && (
        <div data-pestana="usuarios">
          <UsuariosPanel datos={p.usuarios} />
        </div>
      )}
      {tab === 'terminos' && <div data-pestana="terminos">{p.terminos}</div>}
    </div>
  )
}
