'use client'

/**
 * La carpeta del cerebro en pantalla: el campo de la ficha y el formulario que el modal
 * del gate usa para resolverlo ahí mismo. Las reglas (formato, permiso, quién ve el
 * campo) viven en `@/lib/negocios/carpeta-local`; aquí solo se pintan y se envían.
 */
import { useState, useTransition } from 'react'
import { Brain, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { actualizarCarpetaLocalNegocio } from '../negocio-v2-actions'
import {
  EJEMPLO_CARPETA_LOCAL,
  normalizarCarpetaLocal,
} from '@/lib/negocios/carpeta-local'

// ── Campo de la ficha ────────────────────────────────────────────────────────

export function CarpetaLocalEditor({
  negocioId,
  inicial,
  puedeEditar,
}: {
  negocioId: string
  inicial: string | null
  puedeEditar: boolean
}) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(inicial ?? '')
  const [guardada, setGuardada] = useState(inicial)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  function abrir() {
    setValor(guardada ?? '')
    setError(null)
    setEditando(true)
  }

  function cancelar() {
    setEditando(false)
    setError(null)
  }

  function guardar() {
    const normalizada = normalizarCarpetaLocal(valor)
    if (!normalizada.ok) {
      setError(normalizada.error)
      return
    }
    if (normalizada.carpeta === guardada) {
      setEditando(false)
      return
    }
    startTransition(async () => {
      const res = await actualizarCarpetaLocalNegocio(negocioId, valor)
      if (res.error) {
        setError(res.error)
        return
      }
      setGuardada(res.carpeta ?? null)
      setEditando(false)
      setError(null)
      toast.success(res.carpeta ? 'Carpeta del cerebro guardada' : 'Carpeta del cerebro eliminada')
    })
  }

  if (editando) {
    return (
      <div className="w-full space-y-1">
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={e => { e.preventDefault(); guardar() }}
        >
          <input
            autoFocus
            value={valor}
            onChange={e => { setValor(e.target.value); setError(null) }}
            onKeyDown={e => { if (e.key === 'Escape') cancelar() }}
            placeholder={EJEMPLO_CARPETA_LOCAL}
            disabled={pendiente}
            aria-label="Carpeta del cerebro"
            className="h-[30px] w-64 rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={pendiente}
            className="h-[30px] rounded-md px-2.5 text-xs font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--acento)' }}
          >
            {pendiente ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            type="button"
            onClick={cancelar}
            disabled={pendiente}
            className="h-[30px] rounded-md px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancelar
          </button>
        </form>
        {error ? (
          <p className="text-[11px] text-red-600">{error}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Forma: proyectos/cliente/proyecto/. Déjalo vacío para quitarla.
          </p>
        )}
      </div>
    )
  }

  if (guardada) {
    return (
      <span className="inline-flex items-center gap-1.5 group">
        <span
          title="Carpeta del cerebro"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5"
        >
          <Brain className="h-4 w-4 shrink-0 text-slate-500" />
          <span className="font-mono text-xs text-slate-700 select-all">{guardada}</span>
        </span>
        {puedeEditar && (
          <button
            type="button"
            onClick={abrir}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/50 hover:text-muted-foreground"
            title="Editar carpeta del cerebro"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </span>
    )
  }

  if (!puedeEditar) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground/60">
        <Brain className="h-4 w-4 shrink-0" />
        Sin carpeta del cerebro
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={abrir}
      className="inline-flex items-center gap-1.5 border border-dashed border-muted-foreground/30 rounded-md px-2.5 py-1.5 hover:border-muted-foreground/50 hover:bg-accent transition-colors"
    >
      <Brain className="h-4 w-4 text-muted-foreground/50 shrink-0" />
      <span className="text-xs text-muted-foreground/60">Agregar carpeta del cerebro</span>
    </button>
  )
}

// ── Formulario dentro del modal del gate ─────────────────────────────────────

/**
 * El gate de carpeta no se omite (el trigger lo rechaza a cualquiera), así que el modal
 * no se queda en "no se puede": ofrece escribirla. Quien llama guarda y reintenta el
 * avance con los mismos parámetros del intento que falló.
 */
export function CarpetaLocalGateForm({
  pendiente,
  errorServidor,
  onVolver,
  onGuardar,
}: {
  pendiente: boolean
  errorServidor: string | null
  onVolver: () => void
  onGuardar: (carpeta: string) => void
}) {
  const [valor, setValor] = useState('')
  const [errorLocal, setErrorLocal] = useState<string | null>(null)

  function enviar() {
    const normalizada = normalizarCarpetaLocal(valor)
    if (!normalizada.ok) {
      setErrorLocal(normalizada.error)
      return
    }
    // Aquí vacío no es "quitarla": sin carpeta el gate sigue cerrado.
    if (normalizada.carpeta === null) {
      setErrorLocal('Escribe la ruta de la carpeta para poder avanzar.')
      return
    }
    setErrorLocal(null)
    onGuardar(normalizada.carpeta)
  }

  const error = errorLocal ?? errorServidor

  return (
    <form
      className="space-y-2"
      onSubmit={e => { e.preventDefault(); enviar() }}
    >
      <label htmlFor="carpeta-local-gate" className="block text-[11px] font-medium text-tinta-suave">
        Carpeta del cerebro <span className="text-red-500">*</span>
      </label>
      <input
        id="carpeta-local-gate"
        autoFocus
        value={valor}
        onChange={e => { setValor(e.target.value); setErrorLocal(null) }}
        placeholder={EJEMPLO_CARPETA_LOCAL}
        disabled={pendiente}
        className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 font-mono text-xs focus:border-acento focus:outline-none focus:ring-2 focus:ring-acento/15"
      />
      {error ? (
        <p className="text-[11px] leading-relaxed text-red-600">{error}</p>
      ) : (
        <p className="text-[11px] leading-relaxed text-tinta-suave">
          La ruta del negocio en el cerebro, con la forma proyectos/cliente/proyecto/.
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onVolver}
          disabled={pendiente}
          className="flex-1 rounded-lg border border-[#E5E7EB] py-2 text-xs font-medium text-tinta hover:bg-slate-50 disabled:opacity-50"
        >
          Volver
        </button>
        <button
          type="submit"
          disabled={pendiente || valor.trim() === ''}
          className="flex-1 rounded-lg py-2 text-xs font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: 'var(--acento)' }}
        >
          {pendiente ? 'Guardando…' : 'Guardar y avanzar'}
        </button>
      </div>
    </form>
  )
}
