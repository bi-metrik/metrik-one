'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ExternalLink, Wrench } from 'lucide-react'
import type { FilaTablero, Tablero } from '@/lib/ferreteria/datos'
import {
  ESTADOS_PUBLICACION,
  ETIQUETA_ESTADO,
  ETIQUETA_LINEA,
  LINEAS,
  formatoMargen,
  formatoPesos,
  semaforoPendiente,
  type EstadoPublicacion,
  type Linea,
} from '@/lib/ferreteria/reglas'
import { Th, aplicarOrden, useOrden } from './orden-tabla'

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })}%`
}

function etiquetaLinea(l: string | null): string {
  if (!l || l === 'sin_linea') return 'Sin línea'
  return ETIQUETA_LINEA[l as Linea] ?? l
}

type ColPub = 'codigo' | 'producto' | 'precio' | 'ganancia' | 'margen' | 'estado' | 'clics' | 'conversaciones' | 'dias' | 'aviso'

/** Qué se compara en cada columna de Publicaciones. Los «—» llegan como null y van al final. */
const COLUMNAS_PUB: Record<ColPub, (f: FilaTablero) => string | number | null> = {
  codigo: (f) => f.codigo,
  producto: (f) => f.producto,
  precio: (f) => f.precio,
  ganancia: (f) => f.ganancia,
  margen: (f) => f.margen,
  estado: (f) => ETIQUETA_ESTADO[f.estado],
  clics: (f) => f.clics,
  conversaciones: (f) => f.conversaciones,
  dias: (f) => f.diasDesdeUltimoClic,
  aviso: (f) => (f.link ? 'Ver' : null),
}

type ColConv = 'codigo' | 'clics' | 'conversaciones' | 'tasa'
const COLUMNAS_CONV: Record<ColConv, (f: FilaTablero) => string | number | null> = {
  codigo: (f) => f.codigo,
  clics: (f) => f.clics,
  conversaciones: (f) => f.conversaciones,
  tasa: (f) => (f.clics ? f.conversaciones / f.clics : null),
}

type Agrupado = { clave: string; publicaciones: number; clics: number; conversaciones: number; ventas: number; ganancia: number }
type ColGrupo = keyof Agrupado
const COLUMNAS_GRUPO: Record<ColGrupo, (g: Agrupado) => string | number | null> = {
  clave: (g) => g.clave,
  publicaciones: (g) => g.publicaciones,
  clics: (g) => g.clics,
  conversaciones: (g) => g.conversaciones,
  ventas: (g) => g.ventas,
  ganancia: (g) => g.ganancia,
}

export function PuntoPendiente({ tono, titulo }: { tono: 'rojo' | 'ambar' | null; titulo: string }) {
  if (!tono) return null
  return (
    <span
      title={titulo}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${tono === 'rojo' ? 'bg-red-600' : 'bg-amber-500'}`}
      aria-label={titulo}
    />
  )
}

export function FerreteriaCliente({
  tablero,
  hoy,
  ahoraIso,
  puedeEditar,
}: {
  tablero: Tablero
  hoy: string
  /** Lo fija el servidor: el semáforo no llama al reloj durante el render. */
  ahoraIso: string
  puedeEditar: boolean
}) {
  const [pestana, setPestana] = useState<'publicaciones' | 'indicadores'>('publicaciones')
  const [estado, setEstado] = useState<'' | EstadoPublicacion>('')
  const [linea, setLinea] = useState<'' | Linea>('')
  const [marca, setMarca] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const ahora = useMemo(() => new Date(ahoraIso), [ahoraIso])
  const orden = useOrden<ColPub>({ clave: 'codigo', dir: 'asc' })
  // Conversaciones por publicación: arranca como estaba, de más a menos conversaciones.
  const ordenConv = useOrden<ColConv>({ clave: 'conversaciones', dir: 'desc' })

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return tablero.filas.filter(
      (f) =>
        (!estado || f.estado === estado) &&
        (!linea || f.linea === linea) &&
        (!marca || f.marca === marca) &&
        (!q || `${f.codigo} ${f.sku} ${f.producto}`.toLowerCase().includes(q)),
    )
  }, [tablero.filas, estado, linea, marca, busqueda])
  // El orden va después de los filtros: ordena solo lo que se ve.
  const filasVistas = aplicarOrden(filas, orden, COLUMNAS_PUB)

  const pendientes = tablero.filas.filter((f) => f.pendiente_en_canal)
  const enRojo = pendientes.filter((f) => semaforoPendiente(f, ahora) === 'rojo')
  const ind = tablero.indicadores

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Ferretería</h1>
          <span className="text-sm text-muted-foreground">· {tablero.filas.length} publicaciones</span>
        </div>
        {pendientes.length > 0 && (
          <p className="text-sm">
            <span className="font-medium">{pendientes.length}</span> cambio(s) pendiente(s) de aplicar en Marketplace
            {enRojo.length > 0 && <span className="ml-1 font-medium text-red-600">· {enRojo.length} sin aplicar tras dos corridas</span>}
          </p>
        )}
      </header>

      <div className="flex gap-1 border-b">
        {(['publicaciones', 'indicadores'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPestana(p)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${pestana === p ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {p === 'publicaciones' ? 'Publicaciones' : 'Indicadores'}
          </button>
        ))}
      </div>

      {pestana === 'publicaciones' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar código, SKU o producto"
              className="h-9 w-64 rounded-md border bg-background px-3 text-sm"
            />
            <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoPublicacion | '')} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">Todos los estados</option>
              {ESTADOS_PUBLICACION.map((e) => (
                <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>
              ))}
            </select>
            <select value={linea} onChange={(e) => setLinea(e.target.value as Linea | '')} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">Todas las líneas</option>
              {LINEAS.map((l) => (
                <option key={l} value={l}>{ETIQUETA_LINEA[l]}</option>
              ))}
            </select>
            <select value={marca} onChange={(e) => setMarca(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">Todas las marcas</option>
              {tablero.marcas.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {tablero.filas.length === 0 ? (
            <p className="rounded-md border p-6 text-sm text-muted-foreground">
              Todavía no hay publicaciones. Las carga el agente de MeTRIK o la carga inicial.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <Th orden={orden} clave="codigo" className="px-3 py-2">Código</Th>
                    <Th orden={orden} clave="producto" className="px-3 py-2">Producto</Th>
                    <Th orden={orden} clave="precio" derecha className="px-3 py-2">Precio</Th>
                    <Th orden={orden} clave="ganancia" derecha className="px-3 py-2">Ganancia / venta</Th>
                    <Th orden={orden} clave="margen" derecha className="px-3 py-2">Margen</Th>
                    <Th orden={orden} clave="estado" className="px-3 py-2">Estado</Th>
                    <Th orden={orden} clave="clics" derecha className="px-3 py-2">Clics</Th>
                    <Th orden={orden} clave="conversaciones" derecha className="px-3 py-2">Conv.</Th>
                    <Th orden={orden} clave="dias" derecha className="px-3 py-2">Días sin clic</Th>
                    <Th orden={orden} clave="aviso" className="px-3 py-2">Aviso</Th>
                  </tr>
                </thead>
                <tbody>
                  {filasVistas.map((f) => {
                    const tono = semaforoPendiente(f, ahora)
                    return (
                      <tr key={f.id} className="border-t hover:bg-muted/30">
                        <td className="whitespace-nowrap px-3 py-2 font-medium">
                          <div className="flex items-center gap-1.5">
                            <PuntoPendiente
                              tono={tono}
                              titulo={tono === 'rojo' ? `Sin aplicar en Marketplace tras dos corridas${f.ultimo_error_canal ? `: ${f.ultimo_error_canal}` : ''}` : 'Pendiente de aplicar en Marketplace'}
                            />
                            <Link href={`/ferreteria/${encodeURIComponent(f.codigo)}`} className="hover:underline">{f.codigo}</Link>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {f.foto ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={f.foto} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded border bg-muted object-contain" />
                            ) : (
                              <div className="h-10 w-10 shrink-0 rounded border bg-muted" aria-hidden />
                            )}
                            <div className="min-w-0">
                              <div>{f.producto}</div>
                              <div className="text-xs text-muted-foreground">{f.sku}{f.marca ? ` · ${f.marca}` : ''}{f.linea ? ` · ${etiquetaLinea(f.linea)}` : ''}</div>
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{f.precio != null ? formatoPesos(f.precio) : '—'}</td>
                        <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${f.ganancia != null && f.ganancia < 0 ? 'text-red-600' : ''}`}>
                          {f.ganancia != null ? formatoPesos(f.ganancia) : f.costoF == null ? 'sin costo' : '—'}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${f.margen != null && f.margen < 0 ? 'text-red-600' : ''}`}>
                          {formatoMargen(f.margen)}
                        </td>
                        <td className="px-3 py-2">{ETIQUETA_ESTADO[f.estado]}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{f.clics ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{f.conversaciones}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{f.diasDesdeUltimoClic ?? '—'}</td>
                        <td className="px-3 py-2">
                          {f.link ? (
                            <a href={f.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                              Ver <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">sin link</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!puedeEditar && <p className="text-xs text-muted-foreground">Tu rol ve el catálogo; los cambios los hacen el dueño y MeTRIK.</p>}
        </>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi titulo="Clics acumulados" valor={ind.totales.clics.toLocaleString('es-CO')} />
            <Kpi titulo="Conversaciones" valor={ind.totales.conversaciones.toLocaleString('es-CO')} />
            <Kpi titulo="Conversación / clic" valor={pct(ind.tasaConversacionPorClic)} />
            <Kpi titulo="Venta / conversación" valor={pct(ind.tasaVentaPorConversacion)} />
            <Kpi titulo="Ganancia realizada" valor={formatoPesos(ind.totales.ganancia)} detalle={`${ind.totales.ventas} venta(s)`} />
          </div>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Clics por día</h2>
            {ind.clicsPorDia.length === 0 ? (
              <p className="text-sm text-muted-foreground">Hace falta más de una medición por aviso: la primera es la línea base.</p>
            ) : (
              <BarrasDia datos={ind.clicsPorDia.slice(-30)} />
            )}
          </section>

          <section>
            <h2 className="mb-1 text-sm font-semibold">Sin clics en los últimos 7 días</h2>
            <p className="mb-2 text-xs text-muted-foreground">Activas y medidas, candidatas a repreciar o republicar (al {hoy}).</p>
            {ind.sinClics7d.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguna.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {ind.sinClics7d.map((c) => (
                  <Link key={c} href={`/ferreteria/${encodeURIComponent(c)}`} className="whitespace-nowrap rounded border px-2 py-0.5 text-xs hover:bg-muted">{c}</Link>
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            <TablaAgrupada titulo="Por línea" filas={ind.porLinea.map((g) => ({ ...g, clave: etiquetaLinea(g.clave) }))} />
            <TablaAgrupada titulo="Por rango de precio" filas={ind.porRangoPrecio} />
          </div>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Conversaciones por publicación</h2>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <Th orden={ordenConv} clave="codigo" className="px-3 py-2">Código</Th>
                    <Th orden={ordenConv} clave="clics" derecha className="px-3 py-2">Clics</Th>
                    <Th orden={ordenConv} clave="conversaciones" derecha className="px-3 py-2">Conversaciones</Th>
                    <Th orden={ordenConv} clave="tasa" derecha className="px-3 py-2">Conv. / clic</Th>
                  </tr>
                </thead>
                <tbody>
                  {aplicarOrden(
                    tablero.filas.filter((f) => f.conversaciones > 0),
                    ordenConv,
                    COLUMNAS_CONV,
                  ).map((f) => (
                      <tr key={f.id} className="border-t">
                        <td className="whitespace-nowrap px-3 py-1.5">{f.codigo}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{f.clics ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{f.conversaciones}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{f.clics ? pct(f.conversaciones / f.clics) : '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function Kpi({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className="text-lg font-semibold tabular-nums">{valor}</div>
      {detalle && <div className="text-xs text-muted-foreground">{detalle}</div>}
    </div>
  )
}

function BarrasDia({ datos }: { datos: { fecha: string; clics: number }[] }) {
  const max = Math.max(1, ...datos.map((d) => d.clics))
  return (
    <div className="flex h-32 items-end gap-1 rounded-md border p-2">
      {datos.map((d) => (
        <div key={d.fecha} className="flex flex-1 flex-col items-center justify-end" title={`${d.fecha}: ${d.clics} clics`}>
          <div className="w-full rounded-t bg-primary/70" style={{ height: `${(d.clics / max) * 100}%`, minHeight: d.clics > 0 ? 2 : 0 }} />
          <div className="mt-1 text-[9px] text-muted-foreground">{d.fecha.slice(8)}</div>
        </div>
      ))}
    </div>
  )
}

function TablaAgrupada({
  titulo,
  filas,
}: {
  titulo: string
  filas: Agrupado[]
}) {
  const orden = useOrden<ColGrupo>()
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{titulo}</h2>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <Th orden={orden} clave="clave" className="px-3 py-2">{titulo.replace(/^Por /, '').replace(/^./, (c) => c.toUpperCase())}</Th>
              <Th orden={orden} clave="publicaciones" derecha className="px-3 py-2">Pub.</Th>
              <Th orden={orden} clave="clics" derecha className="px-3 py-2">Clics</Th>
              <Th orden={orden} clave="conversaciones" derecha className="px-3 py-2">Conv.</Th>
              <Th orden={orden} clave="ventas" derecha className="px-3 py-2">Ventas</Th>
              <Th orden={orden} clave="ganancia" derecha className="px-3 py-2">Ganancia</Th>
            </tr>
          </thead>
          <tbody>
            {aplicarOrden(filas, orden, COLUMNAS_GRUPO).map((g) => (
              <tr key={g.clave} className="border-t">
                <td className="px-3 py-1.5">{g.clave}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{g.publicaciones}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{g.clics}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{g.conversaciones}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{g.ventas}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{formatoPesos(g.ganancia)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
