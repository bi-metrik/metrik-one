'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { CATEGORIAS_FISCALES_RUBRO, MAX_NOMBRE_RUBRO, type RubroObra } from '@/lib/obras/rubros'
import { eliminarRubroObra, guardarRubroObra, leerRubrosObra } from './obras-config-actions'

const campo = 'block h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground'
const etiqueta = 'min-w-0 space-y-0.5 text-[11px] text-muted-foreground'

type Fila = RubroObra & { gastos: number }

interface Borrador {
  id: string | null
  nombre: string
  descripcion: string
  ejemplos: string
  categoria: string
  orden: string
  activo: boolean
}

const ROTULO_CATEGORIA = new Map<string, string>(CATEGORIAS_FISCALES_RUBRO.map((c) => [c.value, c.label]))

/**
 * «Rubros de obra» en Configuración (C3): los rubros que el asistente ofrece en cada gasto, con su
 * descripción y ejemplos (el modelo los lee para decidir) y la categoría fiscal a la que van. Un
 * rubro con gastos no se borra: se desactiva.
 */
export default function RubrosObraSection() {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rubros, setRubros] = useState<Fila[]>([])
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    const r = await leerRubrosObra()
    setCargando(false)
    if (!r.ok) return setError(r.error)
    setError(null)
    setRubros(r.rubros)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const correr = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, exito: string) => {
    if (ocupado) return false
    setOcupado(true)
    try {
      const r = await fn()
      if (!r.ok) {
        toast.error(r.error)
        return false
      }
      toast.success(exito)
      await cargar()
      return true
    } catch {
      toast.error('No se pudo. Vuelve a intentarlo.')
      return false
    } finally {
      setOcupado(false)
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando rubros…
      </div>
    )
  }
  if (error) return <p className="p-4 text-sm text-muted-foreground">{error}</p>

  const nuevo = () =>
    setBorrador({ id: null, nombre: '', descripcion: '', ejemplos: '', categoria: 'materiales', orden: String((rubros.at(-1)?.orden ?? 0) + 1), activo: true })

  return (
    <div className="space-y-4" data-rubros-obra>
      <p className="m-0 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        Son las opciones de rubro de cada gasto de obra, por WhatsApp y en la app. La descripción y los ejemplos ayudan al asistente a elegir el rubro;
        si duda entre dos, pregunta. Sin rubros, los gastos usan las categorías de siempre.
      </p>

      <button type="button" onClick={nuevo} className="inline-flex h-9 items-center gap-1 rounded-md bg-[#10B981] px-3 text-xs font-medium text-white hover:bg-[#059669]">
        <Plus className="h-3.5 w-3.5" /> Agregar rubro
      </button>

      {borrador && (
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2" data-borrador-rubro>
          <label className={etiqueta}>
            Nombre
            <input className={campo} maxLength={MAX_NOMBRE_RUBRO} value={borrador.nombre} onChange={(e) => setBorrador({ ...borrador, nombre: e.target.value })} placeholder="Materiales" />
            <span className="block text-right tabular-nums">
              {borrador.nombre.trim().length}/{MAX_NOMBRE_RUBRO}
            </span>
          </label>
          <label className={etiqueta}>
            Categoría fiscal
            <select className={campo} value={borrador.categoria} onChange={(e) => setBorrador({ ...borrador, categoria: e.target.value })}>
              {CATEGORIAS_FISCALES_RUBRO.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className={`${etiqueta} sm:col-span-2`}>
            Descripción
            <input className={campo} maxLength={300} value={borrador.descripcion} onChange={(e) => setBorrador({ ...borrador, descripcion: e.target.value })} placeholder="Lo que se compra para la obra" />
          </label>
          <label className={`${etiqueta} sm:col-span-2`}>
            Ejemplos
            <input className={campo} maxLength={500} value={borrador.ejemplos} onChange={(e) => setBorrador({ ...borrador, ejemplos: e.target.value })} placeholder="sellante, membrana, primer, cemento" />
          </label>
          <label className={etiqueta}>
            Orden
            <input className={campo} type="number" min={0} max={999} value={borrador.orden} onChange={(e) => setBorrador({ ...borrador, orden: e.target.value })} />
          </label>
          <label className="flex items-end gap-2 pb-2 text-xs">
            <input type="checkbox" checked={borrador.activo} onChange={(e) => setBorrador({ ...borrador, activo: e.target.checked })} /> Activo
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="button"
              disabled={ocupado}
              onClick={async () => {
                const ok = await correr(() => guardarRubroObra(borrador.id, { ...borrador, orden: Number(borrador.orden || 0) }), 'Rubro guardado')
                if (ok) setBorrador(null)
              }}
              className="inline-flex h-9 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
            </button>
            <button type="button" onClick={() => setBorrador(null)} className="h-9 px-2 text-xs text-muted-foreground">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {rubros.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">Todavía no hay rubros de obra.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rubros.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-start gap-2 p-3 text-xs ${r.activo ? '' : 'opacity-60'}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">
                  {r.nombre}
                  {!r.activo && <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal">Inactivo</span>}
                </p>
                {r.descripcion && <p className="mt-0.5 text-muted-foreground">{r.descripcion}</p>}
                {r.ejemplos && <p className="mt-0.5 text-muted-foreground">Ej.: {r.ejemplos}</p>}
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Va a {ROTULO_CATEGORIA.get(r.categoria) ?? r.categoria} · {r.gastos === 1 ? '1 gasto' : `${r.gastos} gastos`}
                </p>
              </div>
              <span className="flex gap-1">
                <button
                  type="button"
                  aria-label="Editar rubro"
                  className="rounded p-1.5 hover:bg-accent"
                  onClick={() =>
                    setBorrador({ id: r.id, nombre: r.nombre, descripcion: r.descripcion ?? '', ejemplos: r.ejemplos ?? '', categoria: r.categoria, orden: String(r.orden), activo: r.activo })
                  }
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {r.gastos > 0 ? (
                  <button
                    type="button"
                    className="rounded border px-2 py-1 text-[11px] hover:bg-accent"
                    disabled={ocupado}
                    onClick={() => void correr(() => guardarRubroObra(r.id, { ...r, activo: !r.activo }), r.activo ? 'Rubro desactivado' : 'Rubro activado')}
                  >
                    {r.activo ? 'Desactivar' : 'Activar'}
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="Borrar rubro"
                    className="rounded p-1.5 hover:bg-accent"
                    disabled={ocupado}
                    onClick={() => void correr(() => eliminarRubroObra(r.id), 'Rubro borrado')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
