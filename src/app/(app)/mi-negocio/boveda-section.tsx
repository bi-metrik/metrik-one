'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { KeyRound, Loader2, Lock, PlugZap, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { borrarIntegracionAction, getBoveda, guardarLlaveAction, probarConexionAction } from './boveda-actions'
import type { EntradaAuditoria, EstadoIntegracion } from '@/lib/boveda/integraciones'

// Bóveda de llaves: el dueño conecta las integraciones de su negocio (Bold primero). Las llaves SOLO se escriben: el
// campo nunca se llena con lo guardado y, después de guardar, se vacía. El servidor no devuelve llaves, solo
// «configurada», los últimos 4 y la fecha.

// Texto de las garantías: borrador de Max, lo revisa Vera antes del merge.
export const GARANTIAS_BOVEDA = [
  {
    titulo: 'Bajo tu control',
    texto: 'Solo tú, como dueño del espacio, puedes cargar, reemplazar o borrar una llave. Si la borras, la conexión se corta de inmediato.',
  },
  {
    titulo: 'Guardadas con cifrado',
    texto: 'Las llaves quedan cifradas y solo el servidor de ONE las usa para conectarse. Cada carga, cambio o borrado queda en el registro de abajo, sin la llave.',
  },
  {
    titulo: 'Nadie las vuelve a ver en ONE',
    texto: 'Después de guardarla, la llave no se muestra a nadie en ONE: ni a tu equipo, ni a MéTRIK, ni al asistente. Aquí solo verás sus últimos 4 caracteres y la fecha.',
  },
] as const

const ACCION: Record<EntradaAuditoria['accion'], string> = { cargar: 'Cargó', reemplazar: 'Reemplazó', borrar: 'Borró' }

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }) : ''

export default function BovedaSection() {
  const [cargando, setCargando] = useState(true)
  const [puedeEditar, setPuedeEditar] = useState(false)
  const [integraciones, setIntegraciones] = useState<EstadoIntegracion[]>([])
  const [auditoria, setAuditoria] = useState<EntradaAuditoria[]>([])
  const [error, setError] = useState<string | null>(null)

  const aplicar = useCallback((r: Awaited<ReturnType<typeof getBoveda>>) => {
    setCargando(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError(null)
    setPuedeEditar(r.puedeEditar)
    setIntegraciones(r.integraciones)
    setAuditoria(r.auditoria)
  }, [])

  const recargar = useCallback(() => getBoveda().then(aplicar), [aplicar])

  useEffect(() => {
    getBoveda().then(aplicar)
  }, [aplicar])

  if (cargando) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando bóveda…
      </div>
    )
  }
  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        {GARANTIAS_BOVEDA.map((g) => (
          <p key={g.titulo}>
            <span className="font-semibold text-foreground">{g.titulo}.</span> {g.texto}
          </p>
        ))}
        {!puedeEditar && (
          <p className="flex items-center gap-1.5 font-medium">
            <Lock className="h-3.5 w-3.5" /> Solo el dueño del espacio puede cambiar las llaves.
          </p>
        )}
      </div>

      {integraciones.map((i) => (
        <Integracion key={i.id} integracion={i} puedeEditar={puedeEditar} onCambio={recargar} />
      ))}

      <div className="rounded-xl border bg-card p-4">
        <h4 className="mb-2 text-sm font-semibold">Registro</h4>
        {auditoria.length === 0 ? (
          <p className="text-xs text-muted-foreground">Todavía no hay cambios.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {auditoria.map((a, n) => (
              <li key={n} className="flex flex-wrap justify-between gap-2">
                <span>
                  {a.actor} · {ACCION[a.accion] ?? a.accion} <code className="text-muted-foreground">{a.clave}</code>
                </span>
                <span className="text-muted-foreground">{fecha(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Integracion({ integracion, puedeEditar, onCambio }: { integracion: EstadoIntegracion; puedeEditar: boolean; onCambio: () => Promise<void> }) {
  const [editando, setEditando] = useState<string | null>(null)
  const [valor, setValor] = useState('')
  const [ocupado, start] = useTransition()
  const conectada = integracion.claves.every((c) => c.configurada)
  const alguna = integracion.claves.some((c) => c.configurada)

  const guardar = (clave: string) =>
    start(async () => {
      const r = await guardarLlaveAction(integracion.id, clave, valor)
      setValor('')
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setEditando(null)
      toast.success('Llave guardada')
      await onCambio()
    })

  const borrar = () =>
    start(async () => {
      if (!window.confirm(`¿Borrar las llaves de ${integracion.nombre}? La conexión se corta de inmediato.`)) return
      const r = await borrarIntegracionAction(integracion.id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`${integracion.nombre} desconectado`)
      await onCambio()
    })

  const probar = () =>
    start(async () => {
      const r = await probarConexionAction(integracion.id)
      if (!r.ok) toast.error(r.error)
      else if (r.funciona) toast.success(`${integracion.nombre}: funciona`)
      else toast.error(`${integracion.nombre}: no funciona`)
    })

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">{integracion.nombre}</h4>
          <p className="text-xs text-muted-foreground">{integracion.para}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${conectada ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
          {conectada ? 'Configurada' : alguna ? 'Incompleta' : 'Sin configurar'}
        </span>
      </div>

      <div className="space-y-2">
        {integracion.claves.map((c) => (
          <div key={c.clave} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" /> {c.etiqueta}
              </span>
              <span className="text-xs text-muted-foreground">
                {c.configurada ? `Configurada · …${c.ultimos4 ?? ''} · ${fecha(c.actualizadoAt)}` : 'Sin configurar'}
              </span>
            </div>
            {puedeEditar &&
              (editando === c.clave ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    placeholder="Pega la llave"
                    className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    disabled={ocupado || valor.trim().length === 0}
                    onClick={() => guardar(c.clave)}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Guardar
                  </button>
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => {
                      setEditando(null)
                      setValor('')
                    }}
                    className="rounded-md border px-3 py-1.5 text-xs"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => {
                    setValor('')
                    setEditando(c.clave)
                  }}
                  className="mt-2 text-xs font-medium text-primary hover:underline"
                >
                  {c.configurada ? 'Reemplazar' : 'Cargar'}
                </button>
              ))}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {integracion.probarConexion && alguna && (
          <button type="button" disabled={ocupado} onClick={probar} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs">
            <PlugZap className="h-3.5 w-3.5" /> Probar conexión
          </button>
        )}
        {puedeEditar && alguna && (
          <button type="button" disabled={ocupado} onClick={borrar} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-destructive">
            <Trash2 className="h-3.5 w-3.5" /> Borrar
          </button>
        )}
      </div>
    </div>
  )
}
