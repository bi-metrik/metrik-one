'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'

import { nombreLlano } from '@/lib/fotos/clave'
import { NOMBRE_TIPO_PROVEEDOR, TIPOS_PROVEEDOR, type TipoProveedor } from '@/lib/proveedores/tipos'
import { mesAnio, NOMBRE_SEMAFORO, type Semaforo } from '@/lib/proveedores/vigencia'
import { porRenovar, type ProveedorEnLista } from '@/lib/proveedores/vista'
import { crearProveedor, type PersonaEquipo, type ResultadoCrear } from './actions'
import { PastillaSemaforo } from './semaforo'

const FILTROS_SEMAFORO: (Semaforo | 'todos')[] = ['todos', 'vigente', 'por_vencer', 'vencido', 'sin_fechas', 'sin_tarifario']

/**
 * «Proveedores» (Mauricio, 2026-10-18): la lista con filtros por tipo, ciudad, etiqueta y estado
 * del tarifario, búsqueda por nombre y el atajo de la asesora: «Mis tarifarios por renovar» (los
 * suyos vencidos o por vencer, para saber qué pedir). En celular, una columna sin scroll lateral.
 */
export default function ListaProveedores({
  proveedores,
  equipo,
  yo,
  editable,
  crear = crearProveedor,
}: {
  proveedores: ProveedorEnLista[]
  equipo: PersonaEquipo[]
  yo: string | null
  editable: boolean
  crear?: typeof crearProveedor
}) {
  const router = useRouter()
  const [buscar, setBuscar] = useState('')
  const [tipo, setTipo] = useState<TipoProveedor | ''>('')
  const [ciudad, setCiudad] = useState('')
  const [etiqueta, setEtiqueta] = useState('')
  const [estado, setEstado] = useState<Semaforo | 'todos'>('todos')
  const [mios, setMios] = useState(false)
  const [porClasificar, setPorClasificar] = useState(false)
  // «Con tarifas / Sin tarifas» (brief del 2026-10-21, punto 4): el criterio del buscador de la
  // cotización. Con tarifas = extracción revisada; subir el archivo no cuenta.
  const [conTarifas, setConTarifas] = useState<'todas' | 'con' | 'sin'>('todas')
  const [destino, setDestino] = useState('')
  const [nuevo, setNuevo] = useState<{ nombre: string; tipoProveedor: TipoProveedor; ciudad: string } | null>(null)
  const [duda, setDuda] = useState<{ id: string | null; nombre: string; ciudad: string | null } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // Los departamentos escritos como ciudad van aparte: no son ciudades, son fichas por corregir.
  const { ciudades, departamentos } = useMemo(() => {
    const m = new Map<string, string>()
    const d = new Map<string, string>()
    for (const p of proveedores) {
      if (!p.ciudadClave || !p.ciudad) continue
      const destino = p.ciudadEsDepartamento ? d : m
      if (!destino.has(p.ciudadClave)) destino.set(p.ciudadClave, p.ciudad)
    }
    // Una misma clave puede ser municipio en una ficha («Caldas, Antioquia») y departamento en otra.
    for (const k of m.keys()) d.delete(k)
    const orden = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1], 'es')
    return { ciudades: [...m.entries()].sort(orden), departamentos: [...d.entries()].sort(orden) }
  }, [proveedores])
  const etiquetas = useMemo(() => [...new Set(proveedores.flatMap((p) => p.etiquetas))].sort(), [proveedores])
  const nombrePersona = useMemo(() => new Map(equipo.map((p) => [p.id, p.nombre])), [equipo])
  const destinos = useMemo(() => [...new Set(proveedores.map((p) => p.destino).filter((d): d is string => !!d))].sort((a, b) => a.localeCompare(b, 'es')), [proveedores])
  const incompletas = useMemo(() => proveedores.filter((p) => p.faltas.length > 0).length, [proveedores])
  const cuantasConTarifas = useMemo(() => proveedores.filter((p) => p.tarifas?.citable).length, [proveedores])
  const misPorRenovar = useMemo(() => proveedores.filter((p) => p.responsableId === yo && porRenovar(p.semaforo)).length, [proveedores, yo])

  const visibles = useMemo(() => {
    const q = nombreLlano(buscar)
    return proveedores.filter(
      (p) =>
        (!q || nombreLlano(`${p.nombre} ${p.ciudad ?? ''}`).includes(q)) &&
        (!tipo || p.tipoProveedor === tipo) &&
        (!ciudad || p.ciudadClave === ciudad) &&
        (!etiqueta || p.etiquetas.includes(etiqueta)) &&
        (estado === 'todos' || p.semaforo === estado) &&
        (!destino || p.destino === destino) &&
        (!porClasificar || p.faltas.length > 0) &&
        (conTarifas === 'todas' || (conTarifas === 'con') === !!p.tarifas?.citable) &&
        (!mios || (p.responsableId === yo && porRenovar(p.semaforo))),
    )
  }, [proveedores, buscar, tipo, ciudad, etiqueta, estado, destino, porClasificar, conTarifas, mios, yo])

  const terminar = (r: ResultadoCrear) => {
    if (!r.ok) return void toast.error(r.error)
    if ('duda' in r) return setDuda(r.duda)
    if (r.yaExistia) toast.message('Ya estaba: te llevamos a su ficha.')
    router.push(`/proveedores/${r.id}`)
  }

  const enviar = async (forzar: boolean) => {
    if (!nuevo || ocupado || !nuevo.nombre.trim()) return
    setOcupado(true)
    try {
      terminar(await crear({ nombre: nuevo.nombre, tipoProveedor: nuevo.tipoProveedor, ciudad: nuevo.ciudad || null, forzar }))
    } catch {
      toast.error('No se pudo crear. Vuelve a intentarlo.')
    } finally {
      setOcupado(false)
    }
  }

  const select = 'h-8 min-w-0 rounded-md border bg-background px-2 text-xs'

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6" data-lista-proveedores>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Proveedores</h1>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Hoteles, operadores, parques, transporte y mayoristas, con sus tarifarios. Un hotel o un tour aparece aquí solo la primera vez que entra a
            una cotización.
          </p>
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => (setNuevo({ nombre: '', tipoProveedor: 'hotel', ciudad: '' }), setDuda(null))}
            className="inline-flex items-center gap-1 rounded-md bg-[#10B981] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#059669]"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar proveedor
          </button>
        )}
      </div>

      {nuevo && (
        <form
          className="space-y-2 rounded-lg border bg-muted/30 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void enviar(false)
          }}
          data-nuevo-proveedor
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem_10rem_auto]">
            <label className="min-w-0 space-y-0.5 text-[11px] text-muted-foreground">
              Nombre
              <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} className="block h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground" placeholder="Hotel Las Américas" />
            </label>
            <label className="min-w-0 space-y-0.5 text-[11px] text-muted-foreground">
              Tipo
              <select value={nuevo.tipoProveedor} onChange={(e) => setNuevo({ ...nuevo, tipoProveedor: e.target.value as TipoProveedor })} className={`${select} block w-full text-foreground`}>
                {TIPOS_PROVEEDOR.map((t) => (
                  <option key={t} value={t}>
                    {NOMBRE_TIPO_PROVEEDOR[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 space-y-0.5 text-[11px] text-muted-foreground">
              Ciudad
              <input value={nuevo.ciudad} onChange={(e) => setNuevo({ ...nuevo, ciudad: e.target.value })} className="block h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground" placeholder="Cartagena" />
            </label>
            <div className="flex items-end gap-1">
              <button type="submit" disabled={ocupado || !nuevo.nombre.trim()} className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50">
                {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Crear
              </button>
              <button type="button" onClick={() => (setNuevo(null), setDuda(null))} className="h-8 px-2 text-xs text-muted-foreground">
                Cancelar
              </button>
            </div>
          </div>
          {duda && (
            <div className="rounded-md border border-[#F4D7A1] bg-[#FFF8EC] p-2 text-xs" data-duda-proveedor>
              <p className="m-0">
                ¿Es el mismo que <b>{duda.nombre}</b>
                {duda.ciudad ? ` (${duda.ciudad})` : ''}?
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {duda.id && (
                  <Link href={`/proveedores/${duda.id}`} className="rounded-md border bg-background px-2 py-1 font-medium">
                    Sí, abrir ese
                  </Link>
                )}
                <button type="button" disabled={ocupado} onClick={() => void enviar(true)} className="rounded-md border bg-background px-2 py-1">
                  No, es otro: crearlo
                </button>
              </div>
            </div>
          )}
        </form>
      )}

      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por nombre" className="h-8 w-full rounded-md border bg-background pr-2 pl-7 text-xs" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select aria-label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoProveedor | '')} className={select}>
            <option value="">Todos los tipos</option>
            {TIPOS_PROVEEDOR.map((t) => (
              <option key={t} value={t}>
                {NOMBRE_TIPO_PROVEEDOR[t]}
              </option>
            ))}
          </select>
          <select aria-label="Ciudad" value={ciudad} onChange={(e) => setCiudad(e.target.value)} className={select}>
            <option value="">Todas las ciudades</option>
            {ciudades.map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
            {departamentos.length > 0 && (
              <optgroup label="Departamentos (falta el municipio)">
                {departamentos.map(([k, n]) => (
                  <option key={k} value={k}>
                    {n}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <select aria-label="Etiqueta" value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} className={select}>
            <option value="">Todas las etiquetas</option>
            {etiquetas.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <select aria-label="Tarifario" value={estado} onChange={(e) => setEstado(e.target.value as Semaforo | 'todos')} className={select}>
            {FILTROS_SEMAFORO.map((s) => (
              <option key={s} value={s}>
                {s === 'todos' ? 'Tarifario: todos' : NOMBRE_SEMAFORO[s]}
              </option>
            ))}
          </select>
        </div>
        {destinos.length > 0 && (
          <select aria-label="Destino" value={destino} onChange={(e) => setDestino(e.target.value)} className={`${select} w-full sm:w-auto`}>
            <option value="">Todos los destinos</option>
            {destinos.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setPorClasificar((m) => !m)}
          aria-pressed={porClasificar}
          className={`rounded-full px-3 py-1 text-xs ${porClasificar ? 'bg-foreground text-background' : 'border text-muted-foreground hover:bg-accent'}`}
          data-por-clasificar
        >
          Por clasificar{incompletas > 0 ? ` (${incompletas})` : ''}
        </button>
        <div className="inline-flex overflow-hidden rounded-full border text-xs" role="group" aria-label="Tarifas" data-filtro-tarifas>
          {(['con', 'sin'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setConTarifas((v) => (v === k ? 'todas' : k))}
              aria-pressed={conTarifas === k}
              className={`px-3 py-1 ${conTarifas === k ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent'}`}
              data-con-tarifas={k}
            >
              {k === 'con' ? `Con tarifas (${cuantasConTarifas})` : `Sin tarifas (${proveedores.length - cuantasConTarifas})`}
            </button>
          ))}
        </div>
        {yo && (
          <button
            type="button"
            onClick={() => setMios((m) => !m)}
            aria-pressed={mios}
            className={`rounded-full px-3 py-1 text-xs ${mios ? 'bg-foreground text-background' : 'border text-muted-foreground hover:bg-accent'}`}
            data-mis-por-renovar
          >
            Mis tarifarios por renovar{misPorRenovar > 0 ? ` (${misPorRenovar})` : ''}
          </button>
        )}
        </div>
        {conTarifas !== 'todas' && (
          <p className="m-0 text-[11px] text-muted-foreground">
            Con tarifas = tiene una extracción revisada: es lo que se puede usar en una cotización. Haber subido el archivo no cuenta.
          </p>
        )}
        {porClasificar && (
          <p className="m-0 text-[11px] text-muted-foreground">
            Fichas que no se pueden usar para cotizar: les falta la ciudad (el municipio), el país o el tipo, o la ciudad está por confirmar.
          </p>
        )}
      </div>

      {visibles.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
          {proveedores.length === 0
            ? 'Todavía no hay proveedores. Aparecen solos cuando un hotel o un tour entra a una cotización, o agrégalos con «Agregar proveedor».'
            : mios
              ? 'No tienes tarifarios vencidos ni por vencer. Nada que pedir por ahora.'
              : porClasificar
                ? 'Todas las fichas están completas. Nada por clasificar.'
                : conTarifas === 'con'
                  ? 'Ningún proveedor tiene tarifas revisadas todavía. Se revisan en la ficha, después de extraer el tarifario.'
                  : 'Nada coincide con los filtros.'}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border" data-filas-proveedores>
          {visibles.map((p) => (
            <li key={p.id}>
              <Link href={`/proveedores/${p.id}`} className="flex items-center gap-3 p-2 hover:bg-accent/40" data-proveedor={p.id}>
                <span
                  className="block h-11 w-14 shrink-0 rounded bg-gradient-to-br from-[#e8e5de] to-[#d6d1c6] bg-cover bg-center"
                  style={p.miniatura ? { backgroundImage: `url(${JSON.stringify(p.miniatura)})` } : undefined}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{p.nombre}</span>
                    {p.estrellas ? <span className="shrink-0 text-[11px] text-[#C98A00]" aria-label={`${p.estrellas} estrellas`}>{'★'.repeat(p.estrellas)}</span> : null}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[NOMBRE_TIPO_PROVEEDOR[p.tipoProveedor], p.ciudad, p.responsableId ? nombrePersona.get(p.responsableId) : null].filter(Boolean).join(' · ')}
                  </span>
                  {p.faltas.length > 0 && (
                    <span className="block truncate text-[11px] text-[#9A5F0C]" data-faltas>
                      Por clasificar: {p.faltas.join(' · ')}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <PastillaSemaforo semaforo={p.semaforo} />
                  {p.hasta && (p.semaforo === 'vencido' || p.semaforo === 'por_vencer') && <span className="text-[10.5px] text-muted-foreground">hasta {mesAnio(p.hasta)}</span>}
                  {p.delMayorista && <span className="text-[10.5px] text-muted-foreground">del mayorista</span>}
                  {p.tarifas?.citable && <span className="text-[10.5px] text-[#047857]" data-con-tarifas-fila>con tarifas</span>}
                  {p.tarifas?.porRevisar && <span className="text-[10.5px] text-[#9A5F0C]" data-por-revisar>por revisar</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
