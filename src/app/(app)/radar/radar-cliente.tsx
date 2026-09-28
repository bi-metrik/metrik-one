'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, ExternalLink, EyeOff, Star } from 'lucide-react'
import { formatCOP } from '@/lib/cobros/format'
import { guardarPerfilRadar, marcarProcesoRadar } from '@/lib/radar/acciones'
import type { PerfilEnPantalla, ProcesoEnPantalla } from '@/lib/radar/datos-servidor'
import { exclusionesDeLista, perfilDesdePreset, temasActivos } from '@/lib/radar/biblioteca'
import type { Tema } from '@/lib/radar/puntuar'
import {
  COLUMNAS,
  FILTROS_VACIOS,
  ORDEN_INICIAL,
  POR_PAGINA,
  opcionesDe,
  ordenar,
  parsearConsulta,
  pasaFiltros,
  puntuarTodos,
  resumir,
  type Columna,
  type Filtros,
  type Orden,
  type ProcesoPuntuado,
} from '@/lib/radar/vista'

/**
 * La tabla del Radar. Réplica funcional de `metrik-data/dashboard/index.html` (referencia aprobada
 * por Noor), con lo que esa referencia decidió y que se conserva a propósito:
 *
 *   · Las nueve columnas en su orden: Vence en, Fit, Entidad, Región, Área, Modalidad, RUP, Valor,
 *     Objeto.
 *   · **La fila entera abre el detalle** (no un botón aparte), y el detalle muestra qué temas
 *     cruzaron con su peso — sin eso el fit es un número sin explicación.
 *   · **Flecha en la columna ordenada**, y clic en el encabezado alterna el sentido.
 *   · **Poda por importancia en pantalla angosta**: las columnas se van cayendo de menos a más
 *     importante (Modalidad, Área, Región, RUP), y Vence en / Fit / Entidad / Objeto se quedan.
 *   · El aviso del pie: **el tema es preselección, no decisión**. No es adorno legal; es lo que los
 *     términos de uso dicen y lo que evita que alguien lea el fit como un concepto jurídico.
 *
 * El puntaje se calcula aquí con `puntuar.ts`, la única implementación. Cambiar de perfil no vuelve
 * al servidor a buscar procesos: se repuntúa el universo que ya está en memoria.
 */

interface BibliotecaPantalla {
  grupos: readonly { id: string; nombre: string }[]
  temas: readonly Tema[]
  senalFuerte: number
  presets: Record<string, string>
  descartesDePliego: readonly string[]
  actualizado: string
}

export function RadarCliente({
  procesos,
  perfil,
  biblioteca,
  hoy,
  puedeEditar,
}: {
  procesos: ProcesoEnPantalla[]
  perfil: PerfilEnPantalla
  biblioteca: BibliotecaPantalla
  hoy: string
  puedeEditar: boolean
}) {
  const router = useRouter()
  const [pendiente, iniciar] = useTransition()
  const [preset, setPreset] = useState(perfil.preset)
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS)
  const [orden, setOrden] = useState<Orden>(ORDEN_INICIAL)
  const [pagina, setPagina] = useState(0)
  const [abierto, setAbierto] = useState<string | null>(null)

  // Al cambiar de perfil de fábrica se muestra ese puntaje de inmediato; guardar es otro clic. Así
  // el cliente compara sectores antes de comprometerse con uno.
  const enPantalla = useMemo(
    () => (preset === perfil.preset ? perfil : { ...perfil, ...perfilDesdePreset(preset), propios: [] }),
    [preset, perfil],
  )

  const puntuados = useMemo(
    () =>
      puntuarTodos(procesos, {
        temas: temasActivos({
          seleccionados: enPantalla.seleccionados,
          pesos: enPantalla.pesos,
          propios: enPantalla.propios,
        }),
        senalFuerte: biblioteca.senalFuerte,
        exclusiones: exclusionesDeLista(enPantalla.exclusiones),
        seguidos: enPantalla.seguidos,
        ocultos: enPantalla.ocultos,
        hoy,
      }),
    [procesos, enPantalla, biblioteca.senalFuerte, hoy],
  )

  const visibles = useMemo(() => {
    const q = parsearConsulta(filtros.q)
    return puntuados.filter((x) => pasaFiltros(x, filtros, q))
  }, [puntuados, filtros])

  const ordenados = useMemo(() => ordenar(visibles, orden), [visibles, orden])
  const resumen = useMemo(() => resumir(visibles), [visibles])
  const regiones = useMemo(() => opcionesDe(procesos, 'departamento'), [procesos])
  const areas = useMemo(() => opcionesDe(procesos, 'tipoContrato'), [procesos])

  const paginas = Math.max(1, Math.ceil(ordenados.length / POR_PAGINA))
  const pag = Math.min(pagina, paginas - 1)
  const enLaPagina = ordenados.slice(pag * POR_PAGINA, pag * POR_PAGINA + POR_PAGINA)

  const nTemas = enPantalla.seleccionados.length
  const nExcluidos = puntuados.filter((x) => x.excluidoPor).length

  function cambiar(parcial: Partial<Filtros>) {
    setFiltros((f) => ({ ...f, ...parcial }))
    setPagina(0)
  }

  function alternarOrden(col: Columna) {
    setOrden((o) => (o.col === col ? { col, asc: !o.asc } : { col, asc: col === 'dias' || col === 'entidad' }))
    setPagina(0)
  }

  function guardar() {
    iniciar(async () => {
      const r = await guardarPerfilRadar({
        nombre: enPantalla.nombre,
        preset,
        seleccionados: enPantalla.seleccionados,
        pesos: enPantalla.pesos,
        exclusiones: enPantalla.exclusiones,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Tus temas quedaron guardados en este espacio.')
      router.refresh()
    })
  }

  function marcar(x: ProcesoPuntuado, estado: 'sigue' | 'oculto' | null) {
    iniciar(async () => {
      const r = await marcarProcesoRadar(x.noticeUid, estado)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      {/* ── Perfil ───────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <label htmlFor="radar-preset" className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">
              Temas de mi negocio
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <select
                id="radar-preset"
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                disabled={!puedeEditar}
                className="rounded-md border border-border bg-white px-3 py-1.5 text-sm text-tinta disabled:opacity-60"
              >
                {Object.entries(biblioteca.presets).map(([k, nombre]) => (
                  <option key={k} value={k}>
                    {nombre}
                  </option>
                ))}
              </select>
              <span className="text-sm text-tinta-suave">
                {nTemas} tema{nTemas === 1 ? '' : 's'} activo{nTemas === 1 ? '' : 's'}
                {enPantalla.propios.length > 0 ? ` · ${enPantalla.propios.length} propio(s)` : ''}
              </span>
            </div>
          </div>
          {puedeEditar && (
            <button
              type="button"
              onClick={guardar}
              disabled={pendiente}
              className="rounded-md bg-acento px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {perfil.id ? 'Guardar mis temas' : 'Guardar este perfil'}
            </button>
          )}
        </div>
        {preset !== perfil.preset && (
          <p className="mt-2 text-sm text-tinta-suave">
            Estás viendo el puntaje del perfil <b>{biblioteca.presets[preset]}</b> sin haberlo guardado. Guárdalo para
            que quede en este espacio.
          </p>
        )}
        {!perfil.id && (
          <p className="mt-2 text-sm text-tinta-suave">
            Este espacio todavía no tiene un perfil guardado: se está usando uno de fábrica. Las marcas de seguimiento
            se guardan en tu perfil, así que necesitan que lo guardes primero.
          </p>
        )}
      </section>

      {/* ── Tarjetas ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta etiqueta="Procesos vigentes" valor={resumen.vigentes.toLocaleString('es-CO')} pie="según el filtro activo" />
        <Tarjeta etiqueta="Sin RUP requerido" valor={resumen.sinRup.toLocaleString('es-CO')} pie="mínima cuantía y RFI" />
        <Tarjeta etiqueta="Para tu negocio" valor={resumen.coinciden.toLocaleString('es-CO')} pie="mencionan algún tema tuyo" />
        <Tarjeta
          etiqueta="Valor total"
          valor={formatCOP(resumen.valorTotal)}
          pie={`${resumen.pronto} cierra${resumen.pronto === 1 ? '' : 'n'} en 5 días o menos`}
        />
      </section>

      {/* ── Filtros ──────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-lg border border-border bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Lista
            id="radar-region"
            etiqueta="Región"
            opciones={regiones}
            elegidas={filtros.regiones}
            onCambio={(regiones) => cambiar({ regiones })}
          />
          <Lista
            id="radar-area"
            etiqueta="Área (tipo de contrato)"
            opciones={areas}
            elegidas={filtros.areas}
            onCambio={(areas) => cambiar({ areas })}
          />
          <div>
            <label htmlFor="radar-min" className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">
              Valor (COP)
            </label>
            <div className="mt-1 flex items-center gap-1">
              <input
                id="radar-min"
                type="number"
                min={0}
                placeholder="Mín"
                value={filtros.min ?? ''}
                onChange={(e) => cambiar({ min: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
              />
              <span className="text-tinta-suave">—</span>
              <input
                type="number"
                min={0}
                placeholder="Máx"
                aria-label="Valor máximo"
                value={filtros.max ?? ''}
                onChange={(e) => cambiar({ max: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor="radar-cierra" className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">
              Cierra dentro de
            </label>
            <select
              id="radar-cierra"
              value={filtros.cierraEn ?? ''}
              onChange={(e) => cambiar({ cierraEn: e.target.value === '' ? null : Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-border bg-white px-2 py-1.5 text-sm"
            >
              <option value="">Cualquier fecha</option>
              <option value="3">3 días</option>
              <option value="7">7 días</option>
              <option value="15">15 días</option>
              <option value="30">30 días</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="radar-q" className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">
            Buscar{' '}
            <span className="font-normal normal-case tracking-normal">— «frase exacta», -excluir, uno|otro</span>
          </label>
          <input
            id="radar-q"
            type="text"
            autoComplete="off"
            placeholder='acrilico, "mobiliario escolar", -mantenimiento'
            value={filtros.q}
            onChange={(e) => cambiar({ q: e.target.value })}
            className="mt-1 w-full rounded-md border border-border px-3 py-1.5 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Casilla
            etiqueta="Sin RUP (mínima cuantía / RFI)"
            marcada={filtros.soloSinRup}
            onCambio={(soloSinRup) => cambiar({ soloSinRup })}
          />
          <Casilla
            etiqueta="Coincide con mis temas"
            marcada={filtros.soloCoincide}
            onCambio={(soloCoincide) => cambiar({ soloCoincide })}
          />
          <Casilla
            etiqueta={`Aplicar mis exclusiones${nExcluidos > 0 ? ` (${nExcluidos})` : ''}`}
            marcada={filtros.aplicarExclusiones}
            onCambio={(aplicarExclusiones) => cambiar({ aplicarExclusiones })}
          />
          <Casilla
            etiqueta="Solo los que sigo"
            marcada={filtros.soloSeguidos}
            onCambio={(soloSeguidos) => cambiar({ soloSeguidos })}
          />
          <button
            type="button"
            onClick={() => {
              setFiltros(FILTROS_VACIOS)
              setPagina(0)
            }}
            className="rounded-md border border-border px-2 py-1 text-sm text-tinta"
          >
            Limpiar filtros
          </button>
        </div>
      </section>

      {/* ── Tabla ────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="text-base font-semibold text-tinta">Procesos</h2>
          <p className="text-sm text-tinta-suave">
            {ordenados.length.toLocaleString('es-CO')} de {procesos.length.toLocaleString('es-CO')}
          </p>
        </div>

        {ordenados.length === 0 ? (
          <p className="p-6 text-sm text-tinta-suave">
            Ningún proceso vigente pasa estos filtros. Prueba a apagar tus exclusiones o a ampliar el rango de valor.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-tinta-suave">
                  {ENCABEZADOS.map((h) => (
                    <th key={h.col} scope="col" className={`p-2 font-semibold ${h.clase ?? ''}`}>
                      <button
                        type="button"
                        onClick={() => alternarOrden(h.col)}
                        className="inline-flex items-center gap-1 uppercase"
                        aria-label={`Ordenar por ${h.titulo}`}
                      >
                        {h.titulo}
                        {orden.col === h.col &&
                          (orden.asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="p-2" aria-label="Detalle" />
                </tr>
              </thead>
              <tbody>
                {enLaPagina.map((x) => {
                  const urgente = x.dias !== null && x.dias <= 5
                  const estaAbierto = abierto === x.noticeUid
                  return (
                    <Fila
                      key={x.noticeUid}
                      x={x}
                      urgente={urgente}
                      abierto={estaAbierto}
                      onAlternar={() => setAbierto(estaAbierto ? null : x.noticeUid)}
                      onMarcar={marcar}
                      pendiente={pendiente}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {paginas > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-border p-3 text-sm">
            <button
              type="button"
              onClick={() => setPagina(pag - 1)}
              disabled={pag === 0}
              className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-tinta-suave">
              Página {pag + 1} de {paginas}
            </span>
            <button
              type="button"
              onClick={() => setPagina(pag + 1)}
              disabled={pag >= paginas - 1}
              className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        )}
      </section>

      {/* ── El aviso: es lo que dicen los términos de uso ─────────── */}
      <section className="rounded-lg border border-border bg-papel p-4 text-sm text-tinta">
        <p>
          <b>El tema es preselección, no decisión.</b> El puntaje solo dice que el objeto del proceso menciona lo que te
          interesa; el pliego puede exigir RUP, experiencia o capacidad financiera que no tengas. Antes de presentarse
          hay que leerlo y descartar por: {biblioteca.descartesDePliego.join(', ')}.
        </p>
        <p className="mt-2 text-tinta-suave">
          Fuente: SECOP II Procesos de Contratación (datos.gov.co, <code>p6dx-8zbt</code>). MéTRIK no garantiza que el
          dataset esté completo ni vigente. Biblioteca de temas actualizada el {biblioteca.actualizado}.
        </p>
      </section>
    </div>
  )
}

/**
 * Los encabezados, en el orden de la referencia, con la clase de poda.
 *
 * `hidden … table-cell` es la poda por importancia: en pantalla angosta caen Modalidad (lg), Área y
 * Región (md) y RUP (sm), y se quedan Vence en, Fit, Entidad, Valor y Objeto. El orden de caída no
 * es estético: es de menos a más decisorio para saber si vale la pena abrir el proceso.
 */
const ENCABEZADOS: { col: Columna; titulo: string; clase?: string }[] = [
  { col: 'dias', titulo: 'Vence en' },
  { col: 'fit', titulo: 'Fit' },
  { col: 'entidad', titulo: 'Entidad' },
  { col: 'departamento', titulo: 'Región', clase: 'hidden md:table-cell' },
  { col: 'tipoContrato', titulo: 'Área', clase: 'hidden md:table-cell' },
  { col: 'modalidad', titulo: 'Modalidad', clase: 'hidden lg:table-cell' },
  { col: 'sinRup', titulo: 'RUP', clase: 'hidden sm:table-cell' },
  { col: 'valor', titulo: 'Valor', clase: 'text-right' },
  { col: 'objeto', titulo: 'Objeto', clase: 'hidden lg:table-cell' },
]

// Guard de la referencia: si alguien agrega una columna a `COLUMNAS` sin ponerla acá (o al revés),
// esto no compila. La tabla y el ordenador tienen que hablar de las mismas nueve columnas.
const _columnasCubiertas: Record<Columna, true> = Object.fromEntries(
  ENCABEZADOS.map((h) => [h.col, true]),
) as Record<Columna, true>
void _columnasCubiertas
void COLUMNAS

function Fila({
  x,
  urgente,
  abierto,
  onAlternar,
  onMarcar,
  pendiente,
}: {
  x: ProcesoPuntuado
  urgente: boolean
  abierto: boolean
  onAlternar: () => void
  onMarcar: (x: ProcesoPuntuado, estado: 'sigue' | 'oculto' | null) => void
  pendiente: boolean
}) {
  return (
    <>
      <tr
        onClick={onAlternar}
        className="cursor-pointer border-b border-border align-top hover:bg-papel"
        aria-expanded={abierto}
      >
        <td className={`p-2 whitespace-nowrap ${urgente ? 'font-semibold text-rojo' : ''}`}>
          {x.dias === null ? '—' : x.dias < 0 ? 'Vencido' : `${x.dias} d`}
        </td>
        <td className="p-2 font-mono font-semibold">{x.fit > 0 ? `+${x.fit}` : x.fit}</td>
        <td className="p-2">
          <span className="line-clamp-2">{x.entidad}</span>
          <span className="block text-xs text-tinta-suave">{x.referencia}</span>
        </td>
        <td className="hidden p-2 md:table-cell">{x.departamento}</td>
        <td className="hidden p-2 md:table-cell">{x.tipoContrato}</td>
        <td className="hidden p-2 lg:table-cell">{x.modalidad}</td>
        <td className="hidden p-2 sm:table-cell">{x.sinRup ? 'No exige' : 'Exige'}</td>
        <td className="p-2 text-right whitespace-nowrap">{x.valor ? formatCOP(x.valor) : 'Sondeo'}</td>
        <td className="hidden max-w-md p-2 lg:table-cell">
          <span className="line-clamp-2 text-tinta-suave">{x.objeto}</span>
        </td>
        <td className="p-2 text-right text-xs text-tinta-suave">{abierto ? 'Cerrar' : 'Ver'}</td>
      </tr>
      {abierto && (
        <tr className="border-b border-border bg-papel" onClick={(e) => e.stopPropagation()}>
          <td colSpan={10} className="space-y-3 p-4">
            <p className="text-sm text-tinta">{x.objeto}</p>
            <div className="flex flex-wrap gap-2">
              {x.hits.length === 0 ? (
                <span className="text-xs text-tinta-suave">Ningún tema activo aparece en el objeto.</span>
              ) : (
                x.hits.map((h) => (
                  <span
                    key={h.id}
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      h.peso >= 0 ? 'bg-acento/10 text-acento' : 'bg-rojo/10 text-rojo'
                    }`}
                  >
                    {h.nombre} <b>{h.peso >= 0 ? `+${h.peso}` : h.peso}</b>
                  </span>
                ))
              )}
            </div>
            {x.excluidoPor && (
              <p className="text-xs text-tinta-suave">
                Tus exclusiones lo sacan por «{x.excluidoPor}». Se ve porque las apagaste.
              </p>
            )}
            <dl className="grid grid-cols-2 gap-2 text-xs text-tinta-suave sm:grid-cols-4">
              <Dato etiqueta="Modalidad" valor={x.modalidad || '—'} />
              <Dato etiqueta="Región" valor={x.departamento} />
              <Dato etiqueta="Duración" valor={x.duracion || '—'} />
              <Dato etiqueta="Cierra" valor={x.fechaCierre ?? 'Sin fecha publicada'} />
            </dl>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onMarcar(x, x.sigue ? null : 'sigue')}
                disabled={pendiente}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs disabled:opacity-60"
              >
                <Star className={`h-3 w-3 ${x.sigue ? 'fill-current text-acento' : ''}`} />
                {x.sigue ? 'Dejar de seguir' : 'Seguir'}
              </button>
              <button
                type="button"
                onClick={() => onMarcar(x, 'oculto')}
                disabled={pendiente}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs disabled:opacity-60"
              >
                <EyeOff className="h-3 w-3" />
                Fuera de alcance
              </button>
              {x.url && (
                <a
                  href={x.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-acento"
                >
                  <ExternalLink className="h-3 w-3" />
                  Abrir en SECOP II
                </a>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="font-semibold uppercase tracking-wide">{etiqueta}</dt>
      <dd className="text-tinta">{valor}</dd>
    </div>
  )
}

function Tarjeta({ etiqueta, valor, pie }: { etiqueta: string; valor: string; pie: string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">{etiqueta}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-tinta">{valor}</p>
      <p className="text-xs text-tinta-suave">{pie}</p>
    </div>
  )
}

function Casilla({
  etiqueta,
  marcada,
  onCambio,
}: {
  etiqueta: string
  marcada: boolean
  onCambio: (v: boolean) => void
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-tinta">
      <input type="checkbox" checked={marcada} onChange={(e) => onCambio(e.target.checked)} />
      {etiqueta}
    </label>
  )
}

/** Un filtro de varias opciones. Muestra el conteo: una opción con 0 procesos es una respuesta. */
function Lista({
  id,
  etiqueta,
  opciones,
  elegidas,
  onCambio,
}: {
  id: string
  etiqueta: string
  opciones: { valor: string; n: number }[]
  elegidas: readonly string[]
  onCambio: (v: string[]) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">
        {etiqueta}
      </label>
      <select
        id={id}
        multiple
        value={[...elegidas]}
        onChange={(e) => onCambio([...e.target.selectedOptions].map((o) => o.value))}
        className="mt-1 h-[4.5rem] w-full rounded-md border border-border bg-white px-2 py-1 text-sm"
      >
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.valor} ({o.n})
          </option>
        ))}
      </select>
    </div>
  )
}
