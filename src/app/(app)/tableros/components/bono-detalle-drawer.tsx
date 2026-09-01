'use client'

/**
 * Panel lateral del bono: los casos detras de un puntaje.
 *
 * La tabla dice "1/43" o "80%" y hasta ahora no habia forma de ver cuales casos son.
 * Cuando alguien pregunta "por que perdi el indicador", un porcentaje no sirve para
 * conversar: la respuesta es la lista, con su reloj y su motivo.
 *
 * Una sola consulta trae el detalle de los cuatro indicadores y el panel muestra el
 * que se abrio. Es deliberado: el costo de traer los cuatro es el mismo viaje, y
 * permite cambiar de indicador dentro del panel sin volver al servidor.
 *
 * La regla que gobierna la pantalla de arriba tambien gobierna esta: **sin dato no es
 * lo mismo que incumplido**. Un caso sin la referencia que el indicador necesita se
 * pinta gris y dice que le falta, nunca rojo.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Check, ExternalLink, Minus, X } from 'lucide-react'
import type {
  OperacionesBonoData, OperacionesDetalleData, PersonaOperaciones,
} from '../operaciones-types'
import { getOperacionesDetalle } from '../operaciones-actions'

const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const VERDE = '#059669'
const ROJO = '#B91C1C'
const AMBAR = '#B45309'

export type IndicadorBono = 'calidad' | 'radicacion' | 'envio' | 'correcciones'

export const NOMBRE_INDICADOR: Record<IndicadorBono, string> = {
  calidad: 'Calidad',
  radicacion: 'Radicación',
  envio: 'Envío',
  correcciones: 'Correcciones',
}

const fecha = (iso: string | null) =>
  iso === null
    ? '—'
    : new Date(iso).toLocaleString('es-CO', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
      })

const soloFecha = (iso: string | null) =>
  iso === null ? '—' : new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })

export function BonoDetalleDrawer({
  persona, indicador, periodo, parametros: P, onClose, onCambiarIndicador,
}: {
  persona: PersonaOperaciones
  indicador: IndicadorBono
  periodo: { anio: number; mes: number }
  parametros: OperacionesBonoData['parametros']
  onClose: () => void
  onCambiarIndicador: (i: IndicadorBono) => void
}) {
  const [detalle, setDetalle] = useState<OperacionesDetalleData | null>(null)
  const [fallo, setFallo] = useState(false)

  // El padre monta con `key` por persona, asi que cambiar de persona remonta y el
  // estado arranca limpio solo. Cambiar de indicador NO recarga: ya esta todo aqui.
  useEffect(() => {
    let vivo = true
    void getOperacionesDetalle(persona.staff_id, periodo.anio, periodo.mes).then(r => {
      if (!vivo) return
      if (r) setDetalle(r)
      else setFallo(true)
    })
    return () => { vivo = false }
  }, [persona.staff_id, periodo.anio, periodo.mes])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const suspendido =
    (indicador === 'radicacion' && P.peso_radicacion === 0) ||
    (indicador === 'envio' && P.peso_envio === 0) ||
    (indicador === 'correcciones' && P.peso_correcciones === 0)

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div className="fixed inset-y-0 right-0 z-[60] w-full max-w-lg animate-in slide-in-from-right duration-200">
        <div className="flex h-full flex-col bg-white shadow-2xl">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3"
            style={{ borderColor: BORDE }}>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold" style={{ color: CARBON }}>
                {persona.nombre}
              </h2>
              <p className="mt-0.5 text-[11px]" style={{ color: GRIS }}>
                {NOMBRE_INDICADOR[indicador]} · {MES_LARGO(periodo)}
              </p>
            </div>
            <button type="button" onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 hover:bg-[#F5F4F2]" aria-label="Cerrar">
              <X className="h-4 w-4" style={{ color: GRIS }} />
            </button>
          </div>

          {/* Cambiar de indicador sin cerrar: la conversacion salta entre los cuatro
              ("perdi radicacion" -> "y correcciones como voy") y volver a la tabla
              para cada salto la interrumpe. No cuesta un viaje al servidor. */}
          <div className="flex shrink-0 gap-1 border-b px-3 py-2" style={{ borderColor: BORDE }}>
            {(Object.keys(NOMBRE_INDICADOR) as IndicadorBono[]).map(i => (
              <button key={i} type="button" onClick={() => onCambiarIndicador(i)}
                className="rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors"
                style={i === indicador
                  ? { backgroundColor: '#F5F4F2', color: CARBON }
                  : { color: GRIS }}>
                {NOMBRE_INDICADOR[i]}
              </button>
            ))}
          </div>

          <Encabezado persona={persona} indicador={indicador} P={P} suspendido={suspendido} />

          <div className="flex-1 overflow-y-auto p-3">
            {fallo ? (
              <p className="py-8 text-center text-xs" style={{ color: ROJO }}>
                No se pudo cargar el detalle.
              </p>
            ) : detalle === null ? (
              <p className="py-8 text-center text-xs" style={{ color: GRIS }}>Cargando…</p>
            ) : indicador === 'radicacion' ? (
              <ListaRadicacion detalle={detalle} horas={P.horas_radicacion}
                habil={(P.radicacion_reloj ?? 'habil') === 'habil'} />
            ) : indicador === 'envio' ? (
              <ListaEnvio detalle={detalle} />
            ) : indicador === 'correcciones' ? (
              <ListaCorrecciones detalle={detalle} />
            ) : (
              <ListaCalidad detalle={detalle} />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MES_LARGO = (p: { anio: number; mes: number }) => `${MESES_LARGOS[p.mes - 1]} ${p.anio}`

/**
 * La regla del indicador y la cifra que produjo, arriba de la lista. Quien abre el
 * panel viene de un numero y necesita saber contra que se juzgo antes de leer casos.
 */
function Encabezado({ persona: p, indicador, P, suspendido }: {
  persona: PersonaOperaciones
  indicador: IndicadorBono
  P: OperacionesBonoData['parametros']
  suspendido: boolean
}) {
  const habil = (P.radicacion_reloj ?? 'habil') === 'habil'
  const regla =
    indicador === 'radicacion'
      ? `Radicar dentro de ${P.horas_radicacion} horas ${habil ? 'hábiles' : 'corridas'} desde que se asigna el caso.`
      : indicador === 'envio'
        ? `Enviar dentro de ${P.horas_desde_certificado} h del certificado bancario y al menos ${P.horas_antes_cita} h antes de la cita.`
        : indicador === 'correcciones'
          ? 'Cada caso que pasa la etapa de envío cuenta como una radicación ante la DIAN. Solo las devoluciones por error propio bajan el indicador.'
          : `Sin certificados malos se gana completo. Con ${P.calidad_malos_pierde_todo} o más se pierde todo el bono del mes.`

  const cifra =
    indicador === 'radicacion'
      ? (p.radicacion.pct === null ? 'sin casos medibles' :
          `${(p.radicacion.pct * 100).toFixed(1)}% · ${p.radicacion.a_tiempo} de ${p.radicacion.medibles}`)
      : indicador === 'envio'
        ? (p.envio.pct === null ? 'sin casos medibles' :
            `${(p.envio.pct * 100).toFixed(1)}% · ${p.envio.a_tiempo} de ${p.envio.medibles}`)
        : indicador === 'correcciones'
          ? (!p.correcciones.medida ? 'sin medir' :
              `${p.correcciones.correcciones} devolución${p.correcciones.correcciones === 1 ? '' : 'es'} sobre ${p.correcciones.radicaciones} radicaciones`)
          : (!p.calidad_medida ? 'sin medir' :
              `${p.malos} certificado${p.malos === 1 ? '' : 's'} malo${p.malos === 1 ? '' : 's'}`)

  return (
    <div className="shrink-0 border-b px-4 py-3" style={{ borderColor: BORDE, backgroundColor: '#F9FAFB' }}>
      <p className="text-xs font-semibold" style={{ color: CARBON }}>{cifra}</p>
      <p className="mt-1 text-[11px] leading-relaxed" style={{ color: GRIS }}>{regla}</p>
      {suspendido && (
        <p className="mt-1.5 text-[11px] font-medium" style={{ color: AMBAR }}>
          Este mes el indicador está suspendido: los casos se siguen viendo, pero no suman ni restan.
        </p>
      )}
    </div>
  )
}

/** Tarjeta comun. El estado manda el color, y `null` nunca se pinta como incumplido. */
function Caso({ id, codigo, nombre, estado, lineas, etiquetas }: {
  id: string
  codigo: string | null
  nombre: string | null
  estado: boolean | null
  lineas: string[]
  etiquetas?: { texto: string; tono: 'ok' | 'mal' | 'neutro' }[]
}) {
  const Icono = estado === null ? Minus : estado ? Check : AlertTriangle
  const color = estado === null ? '#D1D5DB' : estado ? VERDE : ROJO
  return (
    <li>
      <Link href={`/negocios/${id}`}
        className="block rounded-lg border p-3 transition-colors hover:bg-[#F9FAFB]"
        style={{ borderColor: BORDE }}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <Icono className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color }} />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold" style={{ color: CARBON }}>
                {codigo && <span className="mr-1.5 font-mono" style={{ color: GRIS }}>{codigo}</span>}
                {nombre}
              </p>
              {lineas.map((l, i) => (
                <p key={i} className="mt-0.5 text-[11px]" style={{ color: GRIS }}>{l}</p>
              ))}
            </div>
          </div>
          <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: BORDE }} />
        </div>
        {etiquetas && etiquetas.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[22px]">
            {etiquetas.map((e, i) => (
              <span key={i} className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: e.tono === 'mal' ? '#FEE2E2' : e.tono === 'ok' ? '#ECFDF5' : '#F5F4F2',
                  color: e.tono === 'mal' ? ROJO : e.tono === 'ok' ? VERDE : GRIS,
                }}>
                {e.texto}
              </span>
            ))}
          </div>
        )}
      </Link>
    </li>
  )
}

function Vacio({ texto }: { texto: string }) {
  return <p className="py-8 text-center text-xs" style={{ color: GRIS }}>{texto}</p>
}

function ListaRadicacion({ detalle, horas, habil }: {
  detalle: OperacionesDetalleData; horas: number; habil: boolean
}) {
  if (detalle.radicaciones.length === 0) return <Vacio texto="No radicó ningún caso en el mes." />
  return (
    <ul className="space-y-2">
      {detalle.radicaciones.map(r => (
        <Caso key={r.negocio_id} id={r.negocio_id} codigo={r.codigo} nombre={r.nombre}
          estado={r.a_tiempo}
          lineas={[
            r.inicio === null
              ? (r.sin_rol
                  ? 'Sin medir: la asignación quedó guardada sin decir de qué área es'
                  : 'Sin medir: nadie lo asignó a operaciones')
              : `Asignado ${fecha(r.inicio)} · radicado ${fecha(r.fin)}`,
          ]}
          etiquetas={r.horas === null ? undefined : [
            { texto: `${r.horas} h ${habil ? 'hábiles' : 'corridas'} de ${horas}`,
              tono: r.a_tiempo ? 'ok' : 'mal' },
            // La resta cruda va al lado a proposito: es lo que cualquiera calcula al
            // mirar las dos fechas, y sin ella la conversacion se atasca ahi.
            ...(habil && r.horas_corridas != null && Math.abs(r.horas_corridas - r.horas) > 0.5
              ? [{ texto: `${r.horas_corridas} h corridas`, tono: 'neutro' as const }]
              : []),
          ]} />
      ))}
    </ul>
  )
}

function ListaEnvio({ detalle }: { detalle: OperacionesDetalleData }) {
  if (detalle.envios.length === 0) return <Vacio texto="No envió documentación en el mes." />
  return (
    <ul className="space-y-2">
      {detalle.envios.map(e => (
        <Caso key={e.negocio_id} id={e.negocio_id} codigo={e.codigo} nombre={e.nombre}
          estado={e.a_tiempo}
          lineas={[
            `Enviado ${fecha(e.envio)}`,
            `Certificado ${soloFecha(e.cert_bancario)} · cita ${soloFecha(e.cita)}`,
            ...(e.motivo ? [e.motivo] : []),
          ]}
          etiquetas={[
            ...(e.horas_desde_cert !== null
              ? [{ texto: `${e.horas_desde_cert} h del certificado`, tono: 'neutro' as const }] : []),
            ...(e.horas_antes_cita !== null
              ? [{ texto: `${e.horas_antes_cita} h antes de la cita`, tono: 'neutro' as const }] : []),
          ]} />
      ))}
    </ul>
  )
}

/**
 * El denominador primero, no el numerador. La lista es de radicaciones ante la DIAN
 * y las devueltas van arriba: son las que explican el puntaje. Mostrar solo las
 * devoluciones dejaria el "sobre 43" sin nada que lo respalde, que es exactamente el
 * numero que estuvo mal hasta el 2026-09-01.
 */
function ListaCorrecciones({ detalle }: { detalle: OperacionesDetalleData }) {
  if (detalle.radicaciones_dian.length === 0) {
    return <Vacio texto="Ningún caso pasó la etapa de envío en el mes." />
  }
  const orden = { error_propio: 0, criterio_tercero: 1 } as const
  const lista = [...detalle.radicaciones_dian].sort(
    (a, b) => (a.devuelto ? orden[a.devuelto] : 2) - (b.devuelto ? orden[b.devuelto] : 2),
  )
  return (
    <ul className="space-y-2">
      {lista.map(r => (
        <Caso key={r.negocio_id} id={r.negocio_id} codigo={r.codigo} nombre={r.nombre}
          // Solo el error propio se pinta como incumplido. El de tercero no es un
          // fallo de la persona, es el mismo criterio que ya usa calidad.
          estado={r.devuelto === 'error_propio' ? false : true}
          lineas={[`Pasó a ${r.etapa_destino ?? 'la etapa siguiente'} el ${soloFecha(r.momento)}`]}
          etiquetas={r.devuelto === 'error_propio'
            ? [{ texto: 'Devuelta por error propio', tono: 'mal' }]
            : r.devuelto === 'criterio_tercero'
              ? [{ texto: 'Devuelta por criterio de un tercero, no cuenta', tono: 'neutro' }]
              : undefined} />
      ))}
    </ul>
  )
}

function ListaCalidad({ detalle }: { detalle: OperacionesDetalleData }) {
  const upme = detalle.reprocesos.filter(r => r.tipo === 'certificacion_upme')
  if (upme.length === 0) {
    return <Vacio texto="No se registró ningún certificado malo atribuido a esta persona." />
  }
  return (
    <ul className="space-y-2">
      {upme.map((r, i) => (
        <Caso key={`${r.negocio_id}-${i}`} id={r.negocio_id} codigo={r.codigo} nombre={r.nombre}
          estado={r.causa === 'error_propio' ? false : null}
          lineas={[
            `Ciclo ${r.ciclo} · abierto el ${soloFecha(r.abierto_at)}`,
            ...(r.detalle ? [r.detalle] : []),
          ]}
          etiquetas={[
            r.causa === 'error_propio'
              ? { texto: 'Error propio, cuenta como malo', tono: 'mal' }
              : { texto: 'Criterio de un tercero, no cuenta', tono: 'neutro' },
          ]} />
      ))}
    </ul>
  )
}
