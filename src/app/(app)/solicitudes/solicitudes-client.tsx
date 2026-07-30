'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Phone, Clock, MessageSquare, ChevronDown, ChevronUp, Check, X, User } from 'lucide-react'
import {
  cerrarSolicitud,
  tomarSolicitud,
  type EstadoSolicitud,
  type SolicitudLlamada,
} from '@/lib/actions/solicitudes-llamada'

const C = {
  texto: '#1A1A1A',
  suave: '#6B7280',
  borde: '#E5E7EB',
  fondo: '#F5F4F2',
  verde: '#10B981',
}

const FILTROS: { clave: EstadoSolicitud | 'todas'; label: string }[] = [
  { clave: 'pendiente', label: 'Por llamar' },
  { clave: 'tomado', label: 'En curso' },
  { clave: 'resuelto', label: 'Resueltas' },
  { clave: 'todas', label: 'Todas' },
]

/** "hace 5 minutos" — para saber de un vistazo qué tan fría está la solicitud. */
function haceCuanto(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`
}

export default function SolicitudesClient({ solicitudes }: { solicitudes: SolicitudLlamada[] }) {
  const [filtro, setFiltro] = useState<EstadoSolicitud | 'todas'>('pendiente')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  const conteos = useMemo(() => {
    const c: Record<string, number> = { pendiente: 0, tomado: 0, resuelto: 0, todas: solicitudes.length }
    for (const s of solicitudes) c[s.estado] = (c[s.estado] ?? 0) + 1
    return c
  }, [solicitudes])

  const visibles = useMemo(
    () => (filtro === 'todas' ? solicitudes : solicitudes.filter((s) => s.estado === filtro)),
    [solicitudes, filtro],
  )

  function accion(fn: () => Promise<{ ok: boolean; error?: string }>, exito: string) {
    startTransition(async () => {
      const r = await fn()
      if (r.ok) toast.success(exito)
      else toast.error(r.error ?? 'No se pudo completar')
    })
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: C.texto }}>
          Solicitudes de llamada
        </h1>
        <p className="text-sm mt-1" style={{ color: C.suave }}>
          Lo que el asistente de WhatsApp no resolvió y quedó esperando una llamada.
        </p>
      </header>

      <div className="flex gap-2 flex-wrap mb-6">
        {FILTROS.map((f) => {
          const activo = filtro === f.clave
          return (
            <button
              key={f.clave}
              onClick={() => setFiltro(f.clave)}
              className="px-3 py-1.5 rounded-full text-sm font-medium transition-colors border"
              style={{
                background: activo ? C.texto : 'white',
                color: activo ? 'white' : C.suave,
                borderColor: activo ? C.texto : C.borde,
              }}
            >
              {f.label}
              <span className="ml-1.5 opacity-60">{conteos[f.clave] ?? 0}</span>
            </button>
          )
        })}
      </div>

      {visibles.length === 0 ? (
        <div
          className="rounded-lg border p-10 text-center"
          style={{ borderColor: C.borde, background: C.fondo }}
        >
          <MessageSquare className="w-8 h-8 mx-auto mb-3" style={{ color: C.suave }} />
          <p className="font-medium" style={{ color: C.texto }}>
            {filtro === 'pendiente' ? 'Nada por llamar' : 'Sin solicitudes aquí'}
          </p>
          <p className="text-sm mt-1" style={{ color: C.suave }}>
            {filtro === 'pendiente'
              ? 'Cuando el asistente no pueda resolver algo, la solicitud aparece en esta lista.'
              : 'Cambia de pestaña para ver las demás.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visibles.map((s) => {
            const expandida = abierta === s.id
            return (
              <li
                key={s.id}
                className="rounded-lg border bg-white overflow-hidden"
                style={{ borderColor: C.borde }}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold" style={{ color: C.texto }}>
                          {s.clienteNombre ?? 'Sin identificar'}
                        </span>
                        {s.casoCodigo && (
                          <span
                            className="text-[11px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: C.texto, color: 'white' }}
                          >
                            {s.casoCodigo}
                          </span>
                        )}
                        <span className="text-xs" style={{ color: C.suave }}>
                          {haceCuanto(s.creadaEn)}
                        </span>
                      </div>

                      <p className="mt-1.5 text-sm" style={{ color: C.texto }}>
                        {s.motivo}
                      </p>

                      <div className="mt-2 flex items-center gap-4 flex-wrap text-sm">
                        <a
                          href={`https://wa.me/${s.phone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 hover:underline"
                          style={{ color: C.verde }}
                        >
                          <Phone className="w-3.5 h-3.5" />
                          {s.phone}
                        </a>
                        {s.franja && (
                          <span className="inline-flex items-center gap-1.5" style={{ color: C.suave }}>
                            <Clock className="w-3.5 h-3.5" />
                            Pidió: {s.franja}
                          </span>
                        )}
                        {s.tomadaPor && (
                          <span className="inline-flex items-center gap-1.5" style={{ color: C.suave }}>
                            <User className="w-3.5 h-3.5" />
                            {s.tomadaPor}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      {s.estado === 'pendiente' && (
                        <button
                          disabled={pendiente}
                          onClick={() => accion(() => tomarSolicitud(s.id), 'Solicitud tomada')}
                          className="px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-50"
                          style={{ background: C.verde }}
                        >
                          Tomar
                        </button>
                      )}
                      {(s.estado === 'pendiente' || s.estado === 'tomado') && (
                        <>
                          <button
                            disabled={pendiente}
                            onClick={() => accion(() => cerrarSolicitud(s.id, 'resuelto'), 'Marcada como resuelta')}
                            className="px-3 py-1.5 rounded text-sm font-medium border inline-flex items-center gap-1 disabled:opacity-50"
                            style={{ borderColor: C.borde, color: C.texto }}
                          >
                            <Check className="w-3.5 h-3.5" /> Resuelta
                          </button>
                          <button
                            disabled={pendiente}
                            onClick={() => accion(() => cerrarSolicitud(s.id, 'descartado'), 'Descartada')}
                            className="px-2 py-1.5 rounded text-sm border disabled:opacity-50"
                            style={{ borderColor: C.borde, color: C.suave }}
                            title="Descartar"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {s.resumen && (
                    <p
                      className="mt-3 text-sm rounded p-3"
                      style={{ background: C.fondo, color: C.texto }}
                    >
                      {s.resumen}
                    </p>
                  )}

                  <button
                    onClick={() => setAbierta(expandida ? null : s.id)}
                    className="mt-3 text-xs inline-flex items-center gap-1 hover:underline"
                    style={{ color: C.suave }}
                  >
                    {expandida ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {expandida ? 'Ocultar' : 'Ver'} la conversación ({s.conversacion.length})
                  </button>
                </div>

                {expandida && (
                  <div className="border-t px-4 py-3 space-y-2" style={{ borderColor: C.borde, background: C.fondo }}>
                    {s.conversacion.map((t, i) => (
                      <div key={i} className={t.role === 'user' ? 'text-left' : 'text-right'}>
                        <span
                          className="inline-block max-w-[85%] text-sm rounded-lg px-3 py-2 whitespace-pre-wrap"
                          style={{
                            background: t.role === 'user' ? 'white' : C.texto,
                            color: t.role === 'user' ? C.texto : 'white',
                            border: t.role === 'user' ? `1px solid ${C.borde}` : 'none',
                          }}
                        >
                          {t.text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
