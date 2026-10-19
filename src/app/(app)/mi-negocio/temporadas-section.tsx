'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  diasSinTemporada,
  NOMBRE_TEMPORADA,
  solapes,
  TEMPORADAS,
  temporadaDeFecha,
  type RangoTemporada,
  type Temporada,
} from '@/lib/temporadas/calendario'
import { hoyBogota } from '@/lib/proveedores/vigencia'
import { borrarRango, copiarAnioAnterior, guardarRango, leerTemporadas } from './temporadas-actions'

const campo = 'block h-8 w-full min-w-0 rounded-md border bg-background px-2 text-xs text-foreground'
const etiqueta = 'min-w-0 space-y-0.5 text-[11px] text-muted-foreground'
const COLOR: Record<Temporada, string> = { alta: 'bg-[#FDE2E1] text-[#9B1C1C]', media: 'bg-[#FEF3C7] text-[#92400E]', baja: 'bg-[#DCFCE7] text-[#166534]' }

interface Borrador {
  id: string | null
  temporada: Temporada
  desde: string
  hasta: string
  nombre: string
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const corta = (f: string) => `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1]} ${f.slice(0, 4)}`

/**
 * «Temporadas» en Configuración (Mauricio, 2026-10-19): el calendario propio de la agencia, alta,
 * media y baja por fechas, un año a la vez. Se arma una vez al año con «Copiar de …» (Semana Santa
 * se recalcula sola) y se ajusta. Si dos rangos se pisan, manda alta sobre media sobre baja.
 */
export default function TemporadasSection() {
  const hoy = hoyBogota()
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rangos, setRangos] = useState<RangoTemporada[]>([])
  const [editable, setEditable] = useState(false)
  const [anio, setAnio] = useState(Number(hoy.slice(0, 4)))
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [probar, setProbar] = useState(hoy)

  const cargar = useCallback(async () => {
    const r = await leerTemporadas()
    setCargando(false)
    if (!r.ok) return setError(r.error)
    setError(null)
    setRangos(r.rangos)
    setEditable(r.editable)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const delAnio = useMemo(() => rangos.filter((r) => r.anio === anio).sort((a, b) => a.desde.localeCompare(b.desde)), [rangos, anio])
  const pisados = useMemo(() => solapes(delAnio), [delAnio])
  const libres = useMemo(() => (delAnio.length > 0 ? diasSinTemporada(rangos, anio) : 0), [rangos, delAnio, anio])
  const prueba = useMemo(() => temporadaDeFecha(rangos, probar), [rangos, probar])
  const anteriorTiene = rangos.some((r) => r.anio === anio - 1)

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

  const guardar = async () => {
    if (!borrador) return
    const ok = await correr(() => guardarRango(borrador.id, borrador), 'Guardado')
    if (ok) setBorrador(null)
  }

  const copiar = async () => {
    if (ocupado) return
    setOcupado(true)
    try {
      const r = await copiarAnioAnterior(anio)
      if (!r.ok) return void toast.error(r.error)
      toast.success(
        `Copiados ${r.copiados} rangos de ${anio - 1}.${r.recalculados > 0 ? ' Semana Santa quedó con las fechas de este año: revísala.' : ' Revisa las fechas que cambian cada año.'}`,
      )
      await cargar()
    } catch {
      toast.error('No se pudo copiar. Vuelve a intentarlo.')
    } finally {
      setOcupado(false)
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando temporadas…
      </div>
    )
  }
  if (error) return <p className="p-4 text-sm text-muted-foreground">{error}</p>

  return (
    <div className="space-y-4" data-temporadas>
      <p className="m-0 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        Con este calendario ONE elige la tarifa de un hotel cuando su tarifario no trae fechas. Si dos rangos se pisan, manda alta sobre media sobre baja
        (Semana Santa es alta).
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="h-8 rounded-md border px-2 text-xs" onClick={() => (setAnio(anio - 1), setBorrador(null))} aria-label="Año anterior">
          ‹
        </button>
        <span className="min-w-[3.5rem] text-center text-sm font-semibold" data-anio>
          {anio}
        </span>
        <button type="button" className="h-8 rounded-md border px-2 text-xs" onClick={() => (setAnio(anio + 1), setBorrador(null))} aria-label="Año siguiente">
          ›
        </button>
        {editable && delAnio.length === 0 && anteriorTiene && (
          <button type="button" onClick={() => void copiar()} disabled={ocupado} className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50" data-copiar-anio>
            <Copy className="h-3.5 w-3.5" /> Copiar de {anio - 1}
          </button>
        )}
        {editable && (
          <button
            type="button"
            onClick={() => setBorrador({ id: null, temporada: 'alta', desde: `${anio}-01-01`, hasta: `${anio}-01-15`, nombre: '' })}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-[#10B981] px-3 text-xs font-medium text-white hover:bg-[#059669]"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar rango
          </button>
        )}
      </div>

      {borrador && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[8rem_1fr_9rem_9rem_auto]" data-borrador-rango>
          <label className={etiqueta}>
            Temporada
            <select className={campo} value={borrador.temporada} onChange={(e) => setBorrador({ ...borrador, temporada: e.target.value as Temporada })}>
              {TEMPORADAS.map((t) => (
                <option key={t} value={t}>
                  {NOMBRE_TEMPORADA[t]}
                </option>
              ))}
            </select>
          </label>
          <label className={etiqueta}>
            Nombre (opcional)
            <input className={campo} value={borrador.nombre} onChange={(e) => setBorrador({ ...borrador, nombre: e.target.value })} placeholder="Semana Santa" />
          </label>
          <label className={etiqueta}>
            Desde
            <input type="date" className={campo} value={borrador.desde} onChange={(e) => setBorrador({ ...borrador, desde: e.target.value })} />
          </label>
          <label className={etiqueta}>
            Hasta
            <input type="date" className={campo} value={borrador.hasta} onChange={(e) => setBorrador({ ...borrador, hasta: e.target.value })} />
          </label>
          <div className="col-span-2 flex items-end gap-1 sm:col-span-1">
            <button type="button" onClick={() => void guardar()} disabled={ocupado} className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50">
              {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
            </button>
            <button type="button" onClick={() => setBorrador(null)} className="h-8 px-2 text-xs text-muted-foreground">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {delAnio.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
          {anteriorTiene ? `${anio} no tiene temporadas todavía. Cópialas de ${anio - 1} y ajusta lo que cambie.` : `${anio} no tiene temporadas todavía.`}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border" data-rangos>
          {delAnio.map((r) => (
            <li key={r.id ?? `${r.desde}-${r.temporada}`} className="flex flex-wrap items-center gap-2 p-2 text-xs">
              <span className={`rounded-full px-2 py-0.5 font-medium ${COLOR[r.temporada]}`}>{NOMBRE_TEMPORADA[r.temporada]}</span>
              <span className="tabular-nums">
                {corta(r.desde)} – {corta(r.hasta)}
              </span>
              {r.nombre && <span className="text-muted-foreground">{r.nombre}</span>}
              {editable && r.id && (
                <span className="ml-auto flex gap-1">
                  <button type="button" aria-label="Editar" className="rounded p-1 hover:bg-accent" onClick={() => setBorrador({ id: r.id ?? null, temporada: r.temporada, desde: r.desde, hasta: r.hasta, nombre: r.nombre ?? '' })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label="Quitar" className="rounded p-1 hover:bg-accent" disabled={ocupado} onClick={() => void correr(() => borrarRango(r.id as string), 'Quitado')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {pisados.length > 0 && (
        <p className="m-0 text-[11px] text-muted-foreground">
          {pisados.length === 1 ? 'Un par de rangos se pisa' : `${pisados.length} pares de rangos se pisan`}: en esos días manda la temporada más alta.
        </p>
      )}
      {libres > 0 && <p className="m-0 text-[11px] text-[#9A5F0C]">{libres} días de {anio} no tienen temporada: un hotel sin fechas no sabrá qué tarifa usar esos días.</p>}

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <label className={etiqueta}>
          ¿Qué temporada es el…?
          <input type="date" className={campo} value={probar} onChange={(e) => setProbar(e.target.value)} />
        </label>
        <span className="pb-1.5 text-xs" data-prueba-temporada>
          {prueba ? (
            <>
              <span className={`rounded-full px-2 py-0.5 font-medium ${COLOR[prueba.temporada]}`}>{NOMBRE_TEMPORADA[prueba.temporada]}</span>
              {prueba.rango.nombre ? <span className="text-muted-foreground"> · {prueba.rango.nombre}</span> : null}
            </>
          ) : (
            <span className="text-muted-foreground">Sin temporada definida</span>
          )}
        </span>
      </div>
    </div>
  )
}
