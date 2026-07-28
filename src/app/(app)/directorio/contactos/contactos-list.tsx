'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Phone, Mail, Search, Users, Trash2, Flame, Megaphone, ArrowUpDown, UserCircle,
  Plus, X, Loader2, CheckSquare, Square,
} from 'lucide-react'
import { toast } from 'sonner'
import { FUENTES_ADQUISICION, ROLES_CONTACTO, SEGMENTOS_CONTACTO } from '@/lib/catalogos/constants'
import {
  deleteContacto,
  updateContactoSegmento,
  asignarResponsableContacto,
  asignarResponsableContactosMasivo,
  type ContactoConMeta,
  type StaffOption,
} from '../actions'

interface Props {
  contactos: ContactoConMeta[]
  staff: StaffOption[]
  // staff.id del usuario logueado; se usa para pre-filtrar "Mis contactos" al entrar.
  miStaffId: string | null
  // Rol efectivo del usuario; decide si el pre-filtro por defecto es propio o todo.
  miRol: string | null
  // ¿Puede asignar responsable (owner/admin/supervisor)? Solo UX: el guard real
  // vive en las server actions de asignación.
  canAsignar: boolean
}

/**
 * La tarjeta entera es un <Link>: TODO control interactivo dentro de ella debe
 * frenar la navegación antes de hacer lo suyo. Helper único para no olvidarlo.
 * (Mismo patrón que `negocio-card.tsx`.)
 */
function frenarNavegacion(e: React.MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
}

/**
 * Responsable del contacto, asignable desde el listado sin abrir el detalle.
 *
 * Calca el patrón de `ResponsablesInline` de negocios, con una diferencia de
 * modelo: negocios es N:M (`negocio_responsables`), contactos es 1:1
 * (`contactos.responsable_id`) → aquí hay UN responsable, que se reemplaza o se
 * quita, no una lista de chips.
 */
function ResponsableInline({
  contactoId,
  responsableId,
  responsableNombre,
  staff,
  canAsignar,
  onDone,
}: {
  contactoId: string
  responsableId: string | null
  responsableNombre: string | null
  staff: StaffOption[]
  canAsignar: boolean
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [isPending, startTransition] = useTransition()
  const popoverRef = useRef<HTMLDivElement>(null)

  // Cerrar al hacer click fuera del selector.
  useEffect(() => {
    if (!open) return
    function handleClick(ev: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(ev.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const term = search.trim().toLowerCase()
  const disponibles = staff.filter(
    s => s.id !== responsableId && (!term || s.full_name.toLowerCase().includes(term)),
  )

  const handleToggleOpen = (e: React.MouseEvent) => {
    frenarNavegacion(e)
    setSearch('')
    setOpen(v => !v)
  }

  const aplicar = (nuevoId: string | null, mensaje: string) => {
    startTransition(async () => {
      const res = await asignarResponsableContacto(contactoId, nuevoId)
      if (res.success) {
        toast.success(mensaje)
        onDone()
      } else {
        toast.error(res.error ?? 'Error')
      }
    })
  }

  const handleAsignar = (e: React.MouseEvent, staffId: string, nombre: string) => {
    frenarNavegacion(e)
    setOpen(false)
    setSearch('')
    aplicar(staffId, `Responsable: ${nombre}`)
  }

  const handleQuitar = (e: React.MouseEvent) => {
    frenarNavegacion(e)
    aplicar(null, 'Responsable removido')
  }

  return (
    <div className="relative mt-1 flex flex-wrap items-center gap-1" ref={popoverRef}>
      <UserCircle className="h-2.5 w-2.5 shrink-0 text-[#6B7280]/70" />
      {responsableNombre ? (
        <span
          className="inline-flex max-w-[160px] items-center gap-1 rounded-full bg-[#F5F4F2] px-2 py-0.5 text-[10px] font-medium text-[#6B7280]"
          title={responsableNombre}
        >
          <span className="truncate">{responsableNombre}</span>
          {canAsignar && (
            <button
              type="button"
              onClick={handleQuitar}
              disabled={isPending}
              className="-mr-0.5 shrink-0 rounded-full p-0.5 transition-colors hover:bg-white hover:text-[#1A1A1A] disabled:opacity-60"
              title={`Quitar a ${responsableNombre}`}
              aria-label={`Quitar a ${responsableNombre}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </span>
      ) : (
        !canAsignar && <span className="text-[10px] italic text-[#6B7280]/70">Sin responsable</span>
      )}

      {canAsignar && (
        <button
          type="button"
          onClick={handleToggleOpen}
          disabled={isPending}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-dashed border-[#E5E7EB] px-2 py-0.5 text-[10px] font-medium text-[#6B7280] transition-colors hover:border-[#10B981] hover:text-[#10B981] disabled:opacity-60"
          aria-label={responsableNombre ? 'Cambiar responsable' : 'Asignar responsable'}
        >
          {isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Plus className="h-2.5 w-2.5" />}
          {responsableNombre ? '' : 'Asignar'}
        </button>
      )}

      {open && (
        <div
          onClick={frenarNavegacion}
          className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-[#E5E7EB] bg-white shadow-lg"
        >
          <div className="relative border-b border-[#E5E7EB]">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#6B7280]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar persona…"
              aria-label="Buscar persona"
              className="w-full py-1.5 pl-7 pr-2 text-xs text-[#1A1A1A] placeholder:text-[#6B7280] focus:outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {disponibles.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-[#6B7280]">Sin personas disponibles</p>
            ) : (
              disponibles.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={e => handleAsignar(e, s.id, s.full_name)}
                  className="block w-full truncate px-3 py-1.5 text-left text-xs text-[#1A1A1A] transition-colors hover:bg-[#F5F4F2]"
                >
                  {s.full_name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Valores especiales del filtro de responsable (fuera de un staff.id real).
const RESP_TODOS = '__todos__'
const RESP_SIN = '__sin__'

// Roles que coordinan equipo: entran viendo TODO el directorio, no solo lo suyo.
// Se define explícito (y no vía `puedeCorregirDocumentos`, que coincide en la
// lista de roles pero significa otra cosa) para que los dos criterios puedan
// evolucionar por separado.
const ROLES_VEN_TODO_EL_DIRECTORIO = ['owner', 'admin', 'supervisor']

/**
 * Pre-filtro de responsable al entrar.
 *
 * Antes se pre-filtraba a cualquiera con `staff.id`, sin mirar rol: a las
 * supervisoras (que no son responsables de contactos) la lista les aparecía
 * vacía cada vez que entraban. "Mis contactos" sigue disponible en el selector,
 * solo deja de ser el default para roles gerenciales.
 */
function responsableFilterInicial(miStaffId: string | null, miRol: string | null): string {
  if (!miStaffId) return RESP_TODOS
  if (ROLES_VEN_TODO_EL_DIRECTORIO.includes(miRol ?? '')) return RESP_TODOS
  return miStaffId
}

// Orden de la vista general. Default: ultima interaccion (cualquiera).
type SortKey = 'ultima_interaccion' | 'ultima_interaccion_meta' | 'alfabetico' | 'creacion'
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'ultima_interaccion', label: 'Ultima interaccion' },
  { value: 'ultima_interaccion_meta', label: 'Ultima interaccion de Meta' },
  { value: 'alfabetico', label: 'Alfabetico (A-Z)' },
  { value: 'creacion', label: 'Fecha de creacion' },
]

const SEGMENTO_ORDER = ['sin_contactar', 'contactado', 'convertido', 'inactivo'] as const

export default function ContactosList({ contactos, staff, miStaffId, miRol, canAsignar }: Props) {
  const [search, setSearch] = useState('')
  const [rolFilter, setRolFilter] = useState<string | null>(null)
  const [segmentoFilter, setSegmentoFilter] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>('ultima_interaccion')
  // Filtro de responsable. Quien ejecuta entra pre-filtrado a "Mis contactos";
  // quien coordina (owner/admin/supervisor) entra en Todos y puede acotar.
  const [responsableFilter, setResponsableFilter] = useState<string>(
    responsableFilterInicial(miStaffId, miRol),
  )
  // Selección múltiple para asignación masiva. Se guarda por id; lo que se
  // actúa es SIEMPRE la intersección con la lista visible (ver `seleccionados`),
  // así nunca se asigna un contacto que el filtro actual está escondiendo.
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [destinoMasivo, setDestinoMasivo] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const getFuenteLabel = (value: string | null) =>
    FUENTES_ADQUISICION.find(f => f.value === value)?.label ?? value ?? ''
  const getRolLabel = (value: string | null) =>
    ROLES_CONTACTO.find(r => r.value === value)?.label ?? ''
  const getRolChip = (value: string | null) => {
    if (!value) return undefined
    const colors: Record<string, string> = {
      promotor: 'bg-purple-100 text-purple-700',
      decisor: 'bg-blue-100 text-blue-700',
      influenciador: 'bg-amber-100 text-amber-700',
      operativo: 'bg-gray-100 text-gray-600',
    }
    return colors[value] ?? 'bg-gray-100 text-gray-600'
  }
  const getSegmentoLabel = (value: string | null) =>
    SEGMENTOS_CONTACTO.find(s => s.value === value)?.label ?? ''
  const getSegmentoChip = (value: string | null) =>
    SEGMENTOS_CONTACTO.find(s => s.value === value)?.chipClass ?? 'bg-[#F5F4F2] text-[#6B7280]'

  // Fecha corta absoluta (pura, calcada de negocio-card). Evita Date.now() en
  // render (regla react-hooks/purity).
  const fechaCorta = (date: string | null) => {
    if (!date) return undefined
    try {
      return new Date(date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
    } catch {
      return undefined
    }
  }

  const cycleSegmento = (id: string, currentSegmento: string | null) => {
    const current = currentSegmento ?? 'sin_contactar'
    const currentIdx = SEGMENTO_ORDER.indexOf(current as typeof SEGMENTO_ORDER[number])
    const nextIdx = (currentIdx + 1) % SEGMENTO_ORDER.length
    const next = SEGMENTO_ORDER[nextIdx]
    const nextLabel = SEGMENTOS_CONTACTO.find(s => s.value === next)?.label ?? next

    startTransition(async () => {
      const res = await updateContactoSegmento(id, next)
      if (res.success) {
        toast.success(`Segmento: ${nextLabel}`)
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error')
      }
    })
  }

  const handleDelete = (id: string, nombre: string) => {
    if (!confirm(`Eliminar contacto "${nombre}"?`)) return
    startTransition(async () => {
      const res = await deleteContacto(id)
      if (res.success) {
        toast.success('Contacto eliminado')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const filtered = contactos.filter(c => {
    const matchSearch = !search || c.nombre.toLowerCase().includes(search.toLowerCase())
    const matchRol = !rolFilter || c.rol === rolFilter
    const matchSegmento = !segmentoFilter || c.segmento === segmentoFilter
    const matchResponsable =
      responsableFilter === RESP_TODOS ||
      (responsableFilter === RESP_SIN ? c.responsable_id === null : c.responsable_id === responsableFilter)
    return matchSearch && matchRol && matchSegmento && matchResponsable
  })

  // Orden. Fechas ISO comparadas como string (mismo formato timestamptz) — nulls al final.
  const byDateDesc = (a: string | null, b: string | null) => {
    if (a === b) return 0
    if (!a) return 1
    if (!b) return -1
    return a > b ? -1 : 1
  }
  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'ultima_interaccion':
        return byDateDesc(a.ultima_interaccion_at, b.ultima_interaccion_at)
      case 'ultima_interaccion_meta':
        return byDateDesc(a.ultima_interaccion_meta_at, b.ultima_interaccion_meta_at)
      case 'alfabetico':
        return a.nombre.localeCompare(b.nombre, 'es')
      case 'creacion':
        return byDateDesc(a.created_at, b.created_at)
      default:
        return 0
    }
  })

  // Selección efectiva = lo seleccionado que además está visible con el filtro
  // actual. Si cambias de filtro con cosas marcadas, la barra deja de contarlas
  // (y la asignación no las toca); vuelven a contar si vuelves al filtro. Evita
  // el caso feo de "asigné 40 y no sé cuáles eran".
  const seleccionados = sorted.filter(c => seleccion.has(c.id))
  const todosVisiblesSeleccionados = sorted.length > 0 && seleccionados.length === sorted.length

  const toggleSeleccion = (id: string) => {
    setSeleccion(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSeleccionarVisibles = () => {
    setSeleccion(prev => {
      const next = new Set(prev)
      if (todosVisiblesSeleccionados) sorted.forEach(c => next.delete(c.id))
      else sorted.forEach(c => next.add(c.id))
      return next
    })
  }

  const limpiarSeleccion = () => {
    setSeleccion(new Set())
    setDestinoMasivo('')
  }

  const handleAsignarMasivo = () => {
    if (!destinoMasivo || seleccionados.length === 0) return
    const responsableId = destinoMasivo === RESP_SIN ? null : destinoMasivo
    const nombre = staff.find(s => s.id === responsableId)?.full_name ?? 'Sin responsable'
    const ids = seleccionados.map(c => c.id)
    startTransition(async () => {
      const res = await asignarResponsableContactosMasivo(ids, responsableId)
      if (res.success) {
        toast.success(`${res.actualizados ?? ids.length} contacto(s) → ${nombre}`)
        limpiarSeleccion()
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error')
      }
    })
  }

  if (contactos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
        <Users className="h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-base font-medium">
          Registra tus contactos para nunca perder un negocio
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Los contactos que agregues apareceran aqui
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Search + orden */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar contacto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="relative shrink-0">
          <ArrowUpDown className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortKey)}
            className="appearance-none rounded-lg border bg-background py-2 pl-8 pr-3 text-xs font-medium"
            aria-label="Ordenar contactos"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Filtro de responsable. Default segun rol: gerencial entra en Todos,
          el resto en "Mis contactos" (la opcion sigue disponible para todos). */}
      <div className="relative">
        <UserCircle className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <select
          value={responsableFilter}
          onChange={e => setResponsableFilter(e.target.value)}
          className="w-full appearance-none rounded-lg border bg-background py-2 pl-9 pr-3 text-sm font-medium"
          aria-label="Filtrar por responsable"
        >
          {miStaffId && (
            <option value={miStaffId}>
              Mis contactos ({contactos.filter(c => c.responsable_id === miStaffId).length})
            </option>
          )}
          <option value={RESP_TODOS}>Todos los responsables ({contactos.length})</option>
          <option value={RESP_SIN}>
            Sin responsable ({contactos.filter(c => c.responsable_id === null).length})
          </option>
          {staff
            .filter(s => s.id !== miStaffId)
            .map(s => {
              const count = contactos.filter(c => c.responsable_id === s.id).length
              return (
                <option key={s.id} value={s.id}>{s.full_name} ({count})</option>
              )
            })}
        </select>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex gap-1.5 overflow-x-auto">
          <button
            onClick={() => { setRolFilter(null); setSegmentoFilter(null) }}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              !rolFilter && !segmentoFilter ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            Todos ({contactos.length})
          </button>
          {(() => {
            const metaCount = contactos.filter(c => c.es_meta).length
            if (metaCount === 0) return null
            const active = segmentoFilter === '__meta__'
            return (
              <button
                onClick={() => { setSegmentoFilter(active ? null : '__meta__'); setRolFilter(null) }}
                className={`shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  active ? 'bg-[#1877F2] text-white' : 'bg-[#1877F2]/10 text-[#1877F2] hover:bg-[#1877F2]/20'
                }`}
              >
                <Megaphone className="h-3 w-3" /> Meta ({metaCount})
              </button>
            )
          })()}
          {ROLES_CONTACTO.map(r => {
            const count = contactos.filter(c => c.rol === r.value).length
            if (count === 0) return null
            return (
              <button
                key={r.value}
                onClick={() => { setRolFilter(rolFilter === r.value ? null : r.value); setSegmentoFilter(null) }}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  rolFilter === r.value ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                {r.label} ({count})
              </button>
            )
          })}
        </div>

        <div className="flex gap-1.5 overflow-x-auto">
          {SEGMENTOS_CONTACTO.map(s => {
            const count = contactos.filter(c => c.segmento === s.value).length
            if (count === 0) return null
            return (
              <button
                key={s.value}
                onClick={() => { setSegmentoFilter(segmentoFilter === s.value ? null : s.value); setRolFilter(null) }}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  segmentoFilter === s.value ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                {s.label} ({count})
              </button>
            )
          })}
        </div>
      </div>

      {/* Barra de asignación masiva. Aparece con la primera selección; sticky
          para que quede a la mano al bajar por la lista. Sin selección no ocupa
          espacio (repartir es una tarea puntual, no el modo por defecto). */}
      {canAsignar && (
        <div className="sticky top-0 z-30 -mx-1 space-y-2 rounded-lg border border-[#E5E7EB] bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={toggleSeleccionarVisibles}
              disabled={sorted.length === 0}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] transition-colors hover:text-[#1A1A1A] disabled:opacity-50"
            >
              {todosVisiblesSeleccionados
                ? <CheckSquare className="h-3.5 w-3.5 text-[#10B981]" />
                : <Square className="h-3.5 w-3.5" />}
              {todosVisiblesSeleccionados ? 'Quitar selección' : `Seleccionar los ${sorted.length} visibles`}
            </button>
            {seleccionados.length > 0 && (
              <span className="text-xs font-semibold text-[#1A1A1A]">
                {seleccionados.length} seleccionado{seleccionados.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {seleccionados.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={destinoMasivo}
                onChange={e => setDestinoMasivo(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-[#E5E7EB] bg-white py-1.5 pl-2 pr-2 text-xs"
                aria-label="Asignar seleccionados a"
              >
                <option value="">Asignar a…</option>
                {staff.map(s => (
                  <option key={s.id} value={s.id}>{s.full_name}</option>
                ))}
                <option value={RESP_SIN}>Sin responsable (quitar)</option>
              </select>
              <button
                type="button"
                onClick={handleAsignarMasivo}
                disabled={!destinoMasivo || isPending}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#10B981] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#059669] disabled:opacity-50"
              >
                {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Aplicar
              </button>
              <button
                type="button"
                onClick={limpiarSeleccion}
                disabled={isPending}
                className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-[#6B7280] transition-colors hover:bg-[#F5F4F2] hover:text-[#1A1A1A] disabled:opacity-50"
              >
                Limpiar
              </button>
            </div>
          )}
        </div>
      )}

      {/* Cards (calcado del patron de /negocios) */}
      <div className="space-y-2">
        {sorted.map(c => {
          const segLabel = getSegmentoLabel(c.segmento)
          const segChip = getSegmentoChip(c.segmento)
          const rolLabel = getRolLabel(c.rol)
          const rolChip = getRolChip(c.rol)
          const fuenteLabel = getFuenteLabel(c.fuente_adquisicion)
          const cuando = fechaCorta(c.ultima_interaccion_at ?? c.created_at)
          const campana = c.origen?.campaign_name?.trim() || null
          const marcado = seleccion.has(c.id)

          return (
            <Link
              key={c.id}
              href={`/directorio/contacto/${c.id}`}
              className={`block rounded-xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${
                marcado ? 'border-[#10B981] ring-1 ring-[#10B981]/20' : 'border-[#E5E7EB]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                {canAsignar && (
                  <button
                    type="button"
                    onClick={e => { frenarNavegacion(e); toggleSeleccion(c.id) }}
                    className="mt-0.5 shrink-0 rounded p-0.5 text-[#6B7280] transition-colors hover:text-[#1A1A1A]"
                    role="checkbox"
                    aria-checked={marcado}
                    aria-label={`Seleccionar ${c.nombre}`}
                  >
                    {marcado
                      ? <CheckSquare className="h-4 w-4 text-[#10B981]" />
                      : <Square className="h-4 w-4" />}
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  {/* Fila 1: badges */}
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    {segLabel && (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); cycleSegmento(c.id, c.segmento) }}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${segChip}`}
                        title="Cambiar segmento"
                      >
                        {segLabel}
                      </button>
                    )}
                    {c.es_meta && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-[#1877F2]/10 px-2 py-0.5 text-[10px] font-medium text-[#1877F2]"
                        title="Contacto que llego desde Meta (Facebook/Instagram)"
                      >
                        <Megaphone className="h-2.5 w-2.5" />
                        Meta
                      </span>
                    )}
                    {rolLabel && (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${rolChip}`}>
                        {rolLabel}
                      </span>
                    )}
                  </div>

                  {/* Nombre (ya viene en mayusculas) */}
                  <p className="truncate text-sm font-semibold leading-tight text-[#1A1A1A]">
                    {c.nombre}
                  </p>
                  {fuenteLabel && (
                    <p className="truncate text-[11px] text-[#6B7280]">{fuenteLabel}</p>
                  )}

                  {/* Contacto */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {c.telefono && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[#6B7280]">
                        <Phone className="h-3 w-3" /> {c.telefono}
                      </span>
                    )}
                    {c.email && (
                      <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-[#6B7280]">
                        <Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{c.email}</span>
                      </span>
                    )}
                  </div>

                  {/* Origen de campana (first-touch) */}
                  {(campana || c.es_meta) && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-[#6B7280]">
                      <Megaphone className="h-2.5 w-2.5 text-[#1877F2]" />
                      Origen: Meta
                      {campana && <span className="font-medium text-[#1A1A1A]"> · {campana}</span>}
                      {c.origen?.platform && (
                        <span className="uppercase text-[#6B7280]/70"> ({c.origen.platform})</span>
                      )}
                    </p>
                  )}

                  {/* Responsable del contacto — asignable sin abrir el detalle */}
                  <ResponsableInline
                    contactoId={c.id}
                    responsableId={c.responsable_id}
                    responsableNombre={c.responsable_nombre}
                    staff={staff}
                    canAsignar={canAsignar}
                    onDone={() => router.refresh()}
                  />
                </div>

                {/* Acciones */}
                <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
                  {cuando && <span className="text-[10px] text-[#6B7280]/80">{cuando}</span>}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault(); e.stopPropagation()
                        router.push(`/negocios/nuevo?contacto_id=${c.id}&contacto_nombre=${encodeURIComponent(c.nombre)}`)
                      }}
                      className="rounded p-1 text-[#6B7280] transition-colors hover:bg-[#F5F4F2] hover:text-[#F59E0B]"
                      title="Crear negocio"
                      aria-label="Crear negocio"
                    >
                      <Flame className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(c.id, c.nombre) }}
                      className="rounded p-1 text-[#6B7280] transition-colors hover:bg-[#F5F4F2] hover:text-[#EF4444]"
                      title="Eliminar"
                      aria-label="Eliminar contacto"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
        {sorted.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No se encontraron contactos
          </p>
        )}
      </div>
    </div>
  )
}
