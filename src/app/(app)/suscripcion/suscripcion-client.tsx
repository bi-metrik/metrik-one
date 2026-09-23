'use client'

import { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CreditCard, FileText, LayoutDashboard, Users, X } from 'lucide-react'
import { descartarSustenta, pedirContactoDeSustenta } from './acciones'
import { UsuariosPanel, type DatosUsuarios } from './usuarios-panel'

export type PestanaSuscripcion = 'resumen' | 'pagos' | 'usuarios' | 'terminos'

interface Props {
  tabInicial: PestanaSuscripcion
  /** La tarjeta de pago, o la aceptación de los Términos si están pendientes. Se pinta en el servidor. */
  principal: React.ReactNode
  licencias: { usados: number; total: number } | null
  terminosResumen: string | null
  mostrarSustenta: boolean
  sustentaSolicitada: boolean
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

          {p.mostrarSustenta && !p.sustentaSolicitada && <BloqueSustenta />}
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

/**
 * Sustenta, al pie del Resumen: neutro, descartable y sin precio. «Conocer Sustenta» abre un panel
 * con un solo botón; nada se abre solo.
 */
export function BloqueSustenta() {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [oculto, setOculto] = useState(false)
  const [solicitado, setSolicitado] = useState(false)
  const [pendiente, iniciar] = useTransition()

  if (oculto) return null

  function ahoraNo() {
    iniciar(async () => {
      const r = await descartarSustenta()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setOculto(true)
      router.refresh()
    })
  }

  function quieroQueMeContacten() {
    iniciar(async () => {
      const r = await pedirContactoDeSustenta()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setSolicitado(true)
    })
  }

  return (
    <>
      <section data-bloque-sustenta className="rounded-lg border border-border bg-papel p-4 sm:p-5">
        <p className="text-sm font-semibold text-tinta">Más allá de las listas</p>
        <p className="mt-1 text-sm text-tinta">
          Valida te dice si una persona aparece en una lista. Sustenta organiza todo el sistema de cumplimiento de tu
          CDA: matriz de riesgos, segmentación, vinculación de contrapartes y soportes listos para la auditoría.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className="rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold text-tinta"
          >
            Conocer Sustenta
          </button>
          <button type="button" onClick={ahoraNo} disabled={pendiente} className="text-sm text-tinta-suave">
            Ahora no
          </button>
        </div>
      </section>

      {abierto &&
        createPortal(
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setAbierto(false)}>
          <aside
            role="dialog"
            aria-label="Sustenta"
            data-panel-sustenta
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-tinta">Sustenta</h2>
              <button type="button" aria-label="Cerrar" onClick={() => setAbierto(false)} className="text-tinta-suave">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-tinta">
              El sistema de cumplimiento de tu CDA en un solo lugar, sobre la misma plataforma donde ya usas Valida.
            </p>
            <ul className="mt-4 space-y-3 text-sm text-tinta">
              <li className="rounded-md border border-border p-3">
                <span className="font-semibold">Matriz de riesgos.</span> Riesgos, causas y controles con su
                calificación, al día.
              </li>
              <li className="rounded-md border border-border p-3">
                <span className="font-semibold">Segmentación y contrapartes.</span> La vinculación de cada
                contraparte con sus soportes.
              </li>
              <li className="rounded-md border border-border p-3">
                <span className="font-semibold">Listo para la auditoría.</span> Los soportes ordenados cuando los
                pidan.
              </li>
            </ul>
            <div className="mt-6">
              {solicitado ? (
                <p className="rounded-md bg-papel p-3 text-sm text-tinta" data-sustenta-solicitado>
                  Listo. Alguien de MeTRIK te va a contactar.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={quieroQueMeContacten}
                  disabled={pendiente}
                  className="w-full rounded-md bg-acento px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Quiero que me contacten
                </button>
              )}
            </div>
          </aside>
        </div>,
          document.body,
        )}
    </>
  )
}
