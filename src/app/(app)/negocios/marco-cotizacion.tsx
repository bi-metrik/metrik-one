'use client'

/**
 * El negocio alrededor de la cotización de viaje (Trappvel, layout del 2026-09-23).
 *
 * - Arriba, un encabezado FIJO: volver al negocio, la etapa, el titular en grande y el
 *   viaje (destino con su IATA, fechas, pasajeros). Absorbe el encabezado P9, con su
 *   ámbar cuando al negocio le faltan fechas o pasajeros.
 * - A la derecha (escritorio), una columna fija de SOLO LECTURA: la solicitud tal como
 *   llegó, el contacto, el perfil del cliente y —en las etapas 2 y 3— las cotizaciones
 *   abiertas del negocio para saltar de una a otra sin volver al negocio.
 * - En el celular la columna es una franja bajo el encabezado que abre y cierra
 *   (cerrada al entrar).
 *
 * Vive en el layout de `/negocios/[id]/cotizacion`: al cambiar de cotización el
 * encabezado y la columna no se desmontan. Solo existe para las líneas que cotizan
 * viajes (`leerMarcoDelNegocio` devuelve `null` para el resto): R6.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, ArrowLeft, ChevronDown, Mail, MessageCircle, Phone, Plus } from 'lucide-react'
import { ESTADO_COTIZACION_CONFIG } from '@/lib/catalogos/constants'
import { formatCOP } from '@/lib/cobros/format'
import { telDesdeTelefono, whatsappDesdeTelefono } from '@/lib/contactos/telefono'
import { etiquetaStage } from '@/lib/negocios/stage-label'
import { encabezadoDelMarco, fechaCortaBogota, type MarcoDelNegocio } from '@/lib/cotizaciones/marco-negocio'
import { MarcoCotizacionContexto, VAR_ALTO_ENCABEZADO, type ContextoMarcoCotizacion } from './marco-cotizacion-contexto'

/** El mismo trabajo que protege el aviso al recargar: aquí, antes de irse de la cotización. */
export const PREGUNTA_AL_SALIR =
  'Hay pantallazos leyéndose o aceptándose en esta cotización. Si sales ahora, ese trabajo se corta. ¿Salir igual?'

export default function MarcoCotizacion({ marco, children }: { marco: MarcoDelNegocio; children?: ReactNode }) {
  const params = useParams<{ cotId?: string }>()
  const cotActual = typeof params?.cotId === 'string' ? params.cotId : null

  const enElAire = useRef(false)
  const contexto = useMemo<ContextoMarcoCotizacion>(() => ({
    avisarEnElAire: v => { enElAire.current = v },
  }), [])

  // El alto del encabezado, para que la zona de pegado se pegue justo debajo.
  const encabezado = useRef<HTMLElement>(null)
  const [alto, setAlto] = useState(0)
  useEffect(() => {
    const el = encabezado.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const medir = () => setAlto(el.offsetHeight)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [franjaAbierta, setFranjaAbierta] = useState(false)

  /** Toda salida del marco pregunta si la bandeja tiene trabajo en el aire. */
  function alSalir(e: MouseEvent) {
    if (enElAire.current && !window.confirm(PREGUNTA_AL_SALIR)) e.preventDefault()
  }

  const iata = cotActual ? marco.iataPorCotizacion[cotActual] ?? null : null
  const viaje = encabezadoDelMarco(marco.viaje, iata)
  const etapa = marco.etapa
    ? [etiquetaStage(marco.etapa.stage).toUpperCase(), marco.etapa.numero != null ? `${marco.etapa.numero} · ${marco.etapa.nombre}` : marco.etapa.nombre]
      .filter(Boolean).join(' › ')
    : null
  const cuantas = marco.cotizaciones?.length ?? 0

  return (
    <MarcoCotizacionContexto.Provider value={contexto}>
      <div data-marco-negocio style={{ [VAR_ALTO_ENCABEZADO]: `${alto}px` } as CSSProperties}>
        <header
          ref={encabezado}
          data-encabezado-negocio
          className="sticky top-0 z-20 -mx-6 -mt-6 border-b bg-background/95 px-6 py-3 backdrop-blur"
        >
          <div className="flex items-center justify-between gap-2 text-xs">
            <Link href={`/negocios/${marco.negocioId}`} onClick={alSalir} className="inline-flex items-center gap-1 text-primary hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Volver al negocio
            </Link>
            {etapa && <span className="truncate font-medium uppercase tracking-wide text-muted-foreground">{etapa}</span>}
          </div>
          <h1 className="mt-1 truncate text-xl font-bold uppercase text-[#1A1A1A] sm:text-2xl">
            {marco.titular ?? 'Sin titular'}
          </h1>
          <div
            data-encabezado-viaje
            className={`mt-1 inline-flex max-w-full flex-col rounded-md px-2 py-1 ${viaje.motivo ? 'border border-amber-200 bg-amber-50' : '-mx-2'}`}
          >
            <p className="text-sm font-medium text-[#1A1A1A]">
              {viaje.resumen || 'El negocio todavía no dice a dónde, cuándo ni quiénes viajan'}
            </p>
            {viaje.motivo && (
              <p className="flex items-center gap-1 text-[11px] font-medium text-amber-800">
                <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                {viaje.motivo}
              </p>
            )}
          </div>
        </header>

        {/* Celular: la columna es una franja que abre y cierra. Cerrada al entrar. */}
        <div className="-mx-6 border-b bg-muted/30 px-6 lg:hidden" data-franja-negocio>
          <button
            type="button"
            onClick={() => setFranjaAbierta(v => !v)}
            aria-expanded={franjaAbierta}
            className="flex w-full items-center justify-between gap-2 py-2 text-left text-xs font-medium text-[#1A1A1A]"
          >
            <span>
              Solicitud, cliente{marco.cotizaciones ? ` y cotizaciones (${cuantas})` : ''}
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${franjaAbierta ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {franjaAbierta && (
            <div className="pb-3">
              <ColumnaDelNegocio marco={marco} cotActual={cotActual} alSalir={alSalir} />
            </div>
          )}
        </div>

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-6">
          <div className="min-w-0">{children}</div>
          <aside
            aria-label="El negocio"
            className="sticky hidden overflow-y-auto py-6 lg:block"
            style={{ top: `${alto}px`, maxHeight: `calc(100dvh - ${alto}px - 4rem)` }}
          >
            <ColumnaDelNegocio marco={marco} cotActual={cotActual} alSalir={alSalir} />
          </aside>
        </div>
      </div>
    </MarcoCotizacionContexto.Provider>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="border-b py-3 first:pt-0 last:border-b-0">
      <h2 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h2>
      <div className="space-y-1 text-xs text-[#1A1A1A]">{children}</div>
    </section>
  )
}

function Dato({ etiqueta, valor }: { etiqueta?: string; valor: string | null }) {
  if (!valor) return null
  return (
    <p className="whitespace-pre-line break-words">
      {etiqueta && <span className="text-muted-foreground">{etiqueta}: </span>}
      {valor}
    </p>
  )
}

export function ColumnaDelNegocio({
  marco,
  cotActual,
  alSalir,
}: {
  marco: MarcoDelNegocio
  cotActual: string | null
  alSalir: (e: MouseEvent) => void
}) {
  const s = marco.solicitud
  const tel = telDesdeTelefono(marco.contacto?.telefono)
  const wa = whatsappDesdeTelefono(marco.contacto?.telefono)
  const p = marco.perfil
  const solicitudVacia = !s.destino && !s.alcance && !s.fechas && !s.pasajeros && !s.requisitos

  return (
    <div data-columna-negocio className="rounded-xl border bg-card px-3 py-3">
      <Seccion titulo="Solicitud">
        {solicitudVacia ? (
          <p className="text-muted-foreground">El negocio todavía no tiene la solicitud del viaje.</p>
        ) : (
          <>
            <Dato valor={[s.destino, s.alcance?.toLowerCase()].filter(Boolean).join(' · ') || null} />
            <Dato valor={[s.fechas, s.tipoDeFechas].filter(Boolean).join(' · ') || null} />
            <Dato valor={s.pasajeros} />
            <Dato etiqueta="Requisitos" valor={s.requisitos} />
          </>
        )}
      </Seccion>

      <Seccion titulo="Contacto">
        {marco.contacto ? (
          <>
            <p className="font-semibold">{marco.contacto.nombre}</p>
            {tel && (
              <div className="flex items-center justify-between gap-2">
                <a href={`tel:${tel}`} className="inline-flex min-w-0 items-center gap-1.5 tabular-nums hover:underline">
                  <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{marco.contacto.telefono}</span>
                </a>
                {wa && (
                  <a
                    href={`https://wa.me/${wa}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-[10px] font-medium text-green-700 hover:bg-green-100"
                  >
                    <MessageCircle className="h-3 w-3" aria-hidden />
                    WhatsApp
                  </a>
                )}
              </div>
            )}
            {marco.contacto.email && (
              <a href={`mailto:${marco.contacto.email}`} className="inline-flex min-w-0 items-center gap-1.5 hover:underline">
                <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{marco.contacto.email}</span>
              </a>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">El negocio no tiene contacto.</p>
        )}
      </Seccion>

      <Seccion titulo="Perfil del cliente">
        {p ? (
          <>
            <Dato valor={[p.tipo, p.conQuienViaja ? `viaja con ${p.conQuienViaja.toLowerCase()}` : null].filter(Boolean).join(' · ') || null} />
            <Dato etiqueta="Bolsillo" valor={p.bolsillo} />
            <Dato etiqueta="Preferencias" valor={p.preferencias} />
            <Dato etiqueta="Notas" valor={p.notas} />
          </>
        ) : (
          <p className="text-muted-foreground">Sin perfil todavía.</p>
        )}
      </Seccion>

      {marco.cotizaciones && (
        <Seccion titulo="Cotizaciones">
          <ul className="space-y-1" data-lista-cotizaciones>
            {marco.cotizaciones.map(c => {
              const actual = c.id === cotActual
              const estado = ESTADO_COTIZACION_CONFIG[c.estado as keyof typeof ESTADO_COTIZACION_CONFIG]
              const contenido = (
                <>
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold tabular-nums">{c.codigo}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${estado?.chipClass ?? 'bg-muted'}`}>
                      {estado?.label ?? c.estado}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2 text-muted-foreground">
                    <span className="tabular-nums">{c.valorTotal && c.valorTotal > 0 ? formatCOP(c.valorTotal) : 'Sin total'}</span>
                    {c.editadaEl && <span>edit. {fechaCortaBogota(c.editadaEl)}</span>}
                  </span>
                </>
              )
              return (
                <li key={c.id}>
                  {actual ? (
                    <div aria-current="page" className="flex flex-col rounded-md border-l-2 border-primary bg-primary/5 px-2 py-1.5">
                      {contenido}
                    </div>
                  ) : (
                    <Link
                      href={`/negocios/${marco.negocioId}/cotizacion/${c.id}`}
                      onClick={alSalir}
                      className="flex flex-col rounded-md border-l-2 border-transparent px-2 py-1.5 hover:bg-accent"
                    >
                      {contenido}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
          {marco.puedeCrearCotizacion && (
            <Link
              href={`/negocios/${marco.negocioId}/cotizacion/nueva`}
              prefetch={false}
              onClick={alSalir}
              className="mt-1 inline-flex items-center gap-1 px-2 py-1 font-medium text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Nueva cotización
            </Link>
          )}
        </Seccion>
      )}

      <Link
        href={`/negocios/${marco.negocioId}`}
        onClick={alSalir}
        className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
      >
        Editar en el negocio →
      </Link>
    </div>
  )
}
