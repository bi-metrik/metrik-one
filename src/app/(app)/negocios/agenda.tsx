'use client'

/**
 * La Agenda (hitos de gestión, brief del 2026-10-22; Noor §3.1, §3.4 y §3.5): reemplaza a «Mis
 * pendientes» cuando la línea enciende `config_extra.hitos.activo`. Una sola lista por día.
 *
 *   · Selector de días con scroll horizontal (Hoy siempre a la izquierda).
 *   · Vencido · Hoy · Mañana (o los días escogidos). Fijos por hora, móviles, lo demás, plata en gris.
 *   · Hecho en un toque (con «Deshacer»); con adjunto, «Hecho ⇪» abre la cámara o el archivo y
 *     adjuntar marca hecho. «No aplica» pide motivo. El mensaje al viajero queda listo (`wa.me`):
 *     lo manda la persona, ONE no le escribe a nadie.
 *   · La dirección ve «Todo el equipo», con la inicial de la responsable y un contador por persona
 *     que filtra al tocarlo; puede escoger una persona o «Solo lo mío».
 *   · 375 px: tarjetas a todo el ancho, botones de 44 px, nada en dos columnas.
 */

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BedDouble, Car, FileText, HeartPulse, MoreHorizontal, Package, Plane, Stamp, Ticket, TrainFront, Upload } from 'lucide-react'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { armarAgenda, opcionesDeDias, type Alcance, type SeleccionDia } from '@/lib/viaje/agenda'
import { cuandoEnPalabras, DEFINICIONES, mensajeAlViajero, textoFaltaFecha, type Hito } from '@/lib/viaje/hitos'
import { fechaEnPalabras } from '@/lib/viaje/fechas-servicio'
import { enlaceWhatsApp } from '@/lib/viaje/confirmacion'
import type { Pendiente, ServicioProximo, Tablero } from '@/lib/viaje/mis-pendientes'
import type { DatosAgenda } from '@/lib/viaje/mis-pendientes-datos'
import { COLOR_TIPO, LineaPendiente, MargenDelMes, ServiciosProximos } from './mis-pendientes'
import { adjuntarHito, deshacerHito, marcarHito } from './hitos-actions'

/** Ícono del tipo (los de la cotización); el pre-registro y los hitos del viaje, el suyo. */
function IconoHito({ h }: { h: Hito }) {
  const c = 'h-4 w-4'
  if (h.hitoId === 'preregistro_migratorio') return <Stamp className={c} />
  if (!h.servicioId) return <FileText className={c} />
  switch (h.tipoServicio) {
    case 'vuelo': return <Plane className={c} />
    case 'hotel': return <BedDouble className={c} />
    case 'traslado': return <Car className={c} />
    case 'tren': return <TrainFront className={c} />
    case 'actividad': return <Ticket className={c} />
    case 'asistencia': return <HeartPulse className={c} />
    default: return <Package className={c} />
  }
}

export default function Agenda({
  datos,
  pendientes,
  servicios = [],
  hoy,
  proximo,
  tablero,
  seleccionInicial = 'hoy',
  alcanceInicial,
}: {
  datos: DatosAgenda
  pendientes: Pendiente[]
  servicios?: ServicioProximo[]
  hoy: string
  proximo: { texto: string; fecha: string } | null
  tablero: Tablero | null
  /** Las pruebas de pantalla y las capturas abren un día o un alcance. */
  seleccionInicial?: SeleccionDia
  alcanceInicial?: Alcance
}) {
  const [seleccion, setSeleccion] = useState<SeleccionDia>(seleccionInicial)
  const [alcance, setAlcance] = useState<Alcance>(alcanceInicial ?? (datos.esDireccion ? 'equipo' : 'mio'))
  const persona = { staffId: datos.staffId, esDireccion: datos.esDireccion }
  const agenda = useMemo(
    () => armarAgenda({ hitos: datos.hitos, pendientes, hoy, seleccion, alcance, persona, nombres: datos.nombres, proximoRespaldo: proximo }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datos, pendientes, hoy, seleccion, alcance, proximo],
  )
  const opciones = opcionesDeDias(hoy)
  const enEquipo = datos.esDireccion && alcance === 'equipo'
  const personas = useMemo(() => {
    const ids = new Set(datos.hitos.flatMap(h => h.responsables))
    return [...ids].map(id => ({ id, nombre: datos.nombres[id] ?? 'Sin nombre' })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [datos])
  const etiquetaSel = opciones.find(o => o.clave === seleccion)?.etiqueta ?? 'este día'

  return (
    <div className="space-y-4" data-agenda>
      {tablero && <MargenDelMes tablero={tablero} />}

      {datos.esDireccion && (
        <label className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>Ver</span>
          <select
            value={alcance}
            onChange={e => setAlcance(e.target.value)}
            className="h-11 rounded-md border bg-background px-2 text-sm text-foreground"
            aria-label="De quién ver la agenda"
          >
            <option value="equipo">Todo el equipo</option>
            <option value="mio">Solo lo mío</option>
            {personas.filter(p => p.id !== datos.staffId).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            <option value="sin">Sin responsable</option>
          </select>
        </label>
      )}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Día de la agenda">
        {opciones.map(o => (
          <button
            key={o.clave}
            type="button"
            role="tab"
            aria-selected={seleccion === o.clave}
            onClick={() => setSeleccion(o.clave)}
            className={`min-h-11 shrink-0 whitespace-nowrap rounded-full border px-3 text-sm ${seleccion === o.clave ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground'}`}
          >
            {o.etiqueta}
          </button>
        ))}
      </div>

      {enEquipo && (agenda.contador.length > 0 || agenda.vencidos > 0) && (
        <div className="flex flex-wrap gap-1.5 text-xs" data-contador>
          {agenda.contador.map(c => (
            <button
              key={c.staffId ?? 'sin'}
              type="button"
              onClick={() => setAlcance(c.staffId ?? 'sin')}
              className="min-h-11 rounded-full border px-3"
            >
              {c.nombre} {c.n}
            </button>
          ))}
          {agenda.vencidos > 0 && <span className="inline-flex min-h-11 items-center rounded-full bg-red-50 px-3 font-medium text-red-700">vencidos {agenda.vencidos}</span>}
        </div>
      )}

      {agenda.vacia ? (
        <p className="rounded-lg border p-4 text-center text-sm text-muted-foreground" data-agenda-vacia>
          {seleccion === 'hoy' ? 'Nada para hoy.' : `Nada para ${etiquetaSel.toLowerCase()}.`}
          {agenda.proximo ? ` Lo próximo: ${agenda.proximo.texto} el ${fechaEnPalabras(agenda.proximo.fecha)}.` : ''}
        </p>
      ) : agenda.secciones.map(sec => (
        <section key={sec.clave} className="space-y-2">
          <p className={`text-xs font-semibold uppercase tracking-wide ${sec.vencido ? 'text-red-700' : 'text-foreground'}`}>{sec.titulo} · {sec.lineas.length}</p>
          <ul className="space-y-2">
            {sec.lineas.map(l => l.clase === 'hito'
              ? <LineaHito key={l.clave} h={l.hito} hoy={hoy} vencido={sec.vencido} inicial={enEquipo ? inicialDe(l.hito, datos.nombres) : null} />
              : <LineaPendiente key={l.clave} p={l.pendiente} gris={!!l.pendiente.plata} />)}
          </ul>
        </section>
      ))}

      {agenda.faltan.length > 0 && (
        <section className="space-y-2" data-faltan>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Falta un dato · {agenda.faltan.length}</p>
          <ul className="space-y-2">
            {agenda.faltan.map(h => (
              <li key={h.llave} className="space-y-1.5 rounded-lg border border-dashed p-3 text-sm">
                <p>{textoFaltaFecha(h)}</p>
                <p className="text-xs text-muted-foreground">{h.viaje}</p>
                <Link href={`/negocios/${h.negocioId}`} className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium">
                  {h.estado === 'falta_plazo' ? 'Abrir el viaje' : 'Poner la fecha'}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {agenda.noSeHizo.length > 0 && (
        <details className="rounded-lg border p-3 text-xs" data-no-se-hizo>
          <summary className="cursor-pointer font-medium">No se hizo a tiempo · {agenda.noSeHizo.length}</summary>
          <ul className="mt-2 space-y-1">
            {agenda.noSeHizo.map(h => (
              <li key={h.llave}>
                {h.titulo} · {h.cliente} · {h.fechaAncla ? fechaEnPalabras(h.fechaAncla) : ''}
                {h.responsables[0] ? ` · ${datos.nombres[h.responsables[0]] ?? ''}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Los servicios con fecha del PR de fechas; los que no la tienen ya salen arriba como «Falta un dato». */}
      <ServiciosProximos servicios={servicios.filter(s => s.fecha !== null)} hoy={hoy} />
    </div>
  )
}

function inicialDe(h: Hito, nombres: Readonly<Record<string, string>>): string {
  if (h.responsables.length === 0) return '?'
  return h.responsables.map(r => (nombres[r] ?? '?').charAt(0).toUpperCase()).join('·')
}

function LineaHito({ h, hoy, vencido, inicial }: { h: Hito; hoy: string; vencido: boolean; inicial: string | null }) {
  const cuando = cuandoEnPalabras(h, hoy)
  const momento = h.clase === 'fijo' && h.horaObjetivo ? `desde las ${h.horaObjetivo}` : null
  return (
    <li
      className={`rounded-lg border p-3 text-sm ${vencido ? 'border-red-200' : ''}`}
      style={{ borderLeftWidth: 4, borderLeftColor: h.servicioId ? COLOR_TIPO(h.tipoServicio) : 'var(--tipo-otro)' }}
      data-hito={h.hitoId}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: h.servicioId ? COLOR_TIPO(h.tipoServicio) : 'var(--tipo-otro)' }} aria-hidden>
          <IconoHito h={h} />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="break-words font-medium">{h.titulo}</p>
          <p className="break-words text-xs text-muted-foreground">
            {[h.detalle, h.viaje].filter(Boolean).join(' · ')}
          </p>
          <p className={`text-xs ${vencido ? 'text-red-700' : 'text-muted-foreground'}`}>
            {[cuando, momento, h.cubreDireccion ? 'fin de semana o festivo: lo cubre la dirección' : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        {inicial && (
          <span className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-semibold" title="Quién lo tiene" data-inicial>
            {inicial}
          </span>
        )}
      </div>
      <AccionHito h={h} />
    </li>
  )
}

function AccionHito({ h }: { h: Hito }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransitionTolerante()
  const [modo, setModo] = useState<'nada' | 'nota' | 'no_aplica' | 'menu'>('nada')
  const [texto, setTexto] = useState('')
  const archivo = useRef<HTMLInputElement>(null)
  const def = DEFINICIONES[h.hitoId]
  const mensaje = mensajeAlViajero(h)
  const wa = mensaje ? enlaceWhatsApp(h.telefono, mensaje) : null

  const deshacer = () => startTransition(async () => {
    const r = await deshacerHito({ negocioId: h.negocioId, llave: h.llave })
    if (!r.ok) { toast.error(r.error); return }
    router.refresh()
  })
  const listo = (msg: string) => {
    toast.success(msg, { action: { label: 'Deshacer', onClick: deshacer }, duration: 8000 })
    setModo('nada')
    setTexto('')
    router.refresh()
  }
  const marcar = (estado: 'hecho' | 'no_aplica', nota: string | null) => startTransition(async () => {
    const r = await marcarHito({ negocioId: h.negocioId, llave: h.llave, estado, nota })
    if (!r.ok) { toast.error(r.error); return }
    listo(estado === 'hecho' ? 'Hecho.' : 'Marcado como «No aplica».')
  })
  const subir = (file: File | null | undefined) => {
    if (!file) return
    const fd = new FormData()
    fd.set('negocioId', h.negocioId)
    fd.set('llave', h.llave)
    fd.set('file', file)
    startTransition(async () => {
      const r = await adjuntarHito(fd)
      if (!r.ok) { toast.error(r.error); return }
      listo('Adjunto guardado: hecho.')
    })
  }

  const principal = def.evidencia === 'adjunto'
    ? (
      <>
        <button type="button" disabled={isPending} onClick={() => archivo.current?.click()}
          className="inline-flex min-h-11 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">
          <Upload className="h-4 w-4" aria-hidden /> {isPending ? 'Guardando…' : 'Hecho ⇪'}
        </button>
        {/* Sin `capture`: en el celular ofrece cámara, fotos o archivo (Noor §3.5). */}
        <input ref={archivo} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { subir(e.target.files?.[0]); e.target.value = '' }} />
      </>
    )
    : def.evidencia === 'nota'
      ? <button type="button" disabled={isPending} onClick={() => setModo(m => (m === 'nota' ? 'nada' : 'nota'))} className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">Hecho</button>
      : <button type="button" disabled={isPending} onClick={() => marcar('hecho', null)} className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">{isPending ? 'Guardando…' : 'Hecho'}</button>

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {principal}
        <button type="button" aria-label="Más opciones" aria-expanded={modo === 'menu'} onClick={() => setModo(m => (m === 'menu' ? 'nada' : 'menu'))}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md border">
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {modo === 'menu' && (
        <div className="flex flex-wrap justify-end gap-2" data-menu-hito>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm">Mensaje al viajero</a>
          )}
          {def.evidencia === 'adjunto' && !def.adjuntoObligatorio && (
            <button type="button" disabled={isPending} onClick={() => marcar('hecho', null)} className="min-h-11 rounded-md border px-3 text-sm">Hecho sin adjunto</button>
          )}
          <button type="button" onClick={() => setModo('no_aplica')} className="min-h-11 rounded-md border px-3 text-sm">No aplica</button>
          <Link href={`/negocios/${h.negocioId}`} className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm">Abrir el viaje</Link>
        </div>
      )}
      {(modo === 'nota' || modo === 'no_aplica') && (
        <div className="flex flex-wrap gap-2">
          <input
            autoFocus
            value={texto}
            onChange={e => setTexto(e.target.value)}
            maxLength={500}
            placeholder={modo === 'no_aplica' ? '¿Por qué no aplica? (p. ej. el cliente hizo su check-in)' : def.pideNota ?? ''}
            className="h-11 min-w-0 flex-1 rounded-md border px-2 text-sm"
          />
          <button
            type="button"
            disabled={isPending || !texto.trim()}
            onClick={() => marcar(modo === 'no_aplica' ? 'no_aplica' : 'hecho', texto)}
            className="min-h-11 rounded-md border px-3 text-sm font-medium disabled:opacity-60"
          >
            {modo === 'no_aplica' ? 'No aplica' : 'Guardar'}
          </button>
        </div>
      )}
    </div>
  )
}
