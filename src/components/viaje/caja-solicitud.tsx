'use client'

/**
 * Pieza 1 de la solicitud sin formulario (Noor, §2.2 y §2.3): la caja donde se pega o se escribe
 * lo que contó el cliente, el resumen para confirmar y, en un negocio nuevo, «¿De quién es?».
 *
 * Reglas que no se rompen (§4): «Entender» no escribe en el negocio; sin «Cargar» no se escribe
 * nada; lo cargado queda sugerido. El motor es el del bot (función `solicitud-texto`).
 */

import { useMemo, useState, useSyncExternalStore, useTransition } from 'react'
import { X } from 'lucide-react'
import { BTN, BTN_ELEGIDO, BTN_PRIM, BTN_X, INPUT, LINK, SPIN } from './estilo'
import { cargarSolicitud, descartarSolicitud, entenderSolicitud } from '@/app/(app)/negocios/solicitud-texto-actions'
import {
  TEXTOS,
  nombrePropio,
  primerNombre,
  textoBotonCargar,
  textoClienteUnico,
  textoViajeAbierto,
  type ContactoDecision,
  type ContactoElegido,
  type ContactoWeb,
  type FilaResumen,
  type NegocioElegido,
  type PreguntaGuardian,
  type QuienEscribio,
  type RespuestaCargar,
  type RespuestaEntender,
} from '@/lib/negocios/solicitud-texto'

const LLAVE_QUIEN = 'one.solicitud.quien'

function leerQuien(): QuienEscribio | null {
  try {
    const v = window.localStorage.getItem(LLAVE_QUIEN)
    return v === 'cliente' || v === 'notas' ? v : null
  } catch {
    return null
  }
}

const sinSuscripcion = () => () => {}

function guardarQuien(q: QuienEscribio) {
  try {
    window.localStorage.setItem(LLAVE_QUIEN, q)
  } catch {
    // Sin almacenamiento (ventana privada): se vuelve a preguntar, nada más.
  }
}

type Entendido = Extract<RespuestaEntender, { ok: true }>

const GRUPOS: Array<{ grupo: FilaResumen['grupo']; titulo: string }> = [
  { grupo: 'nuevo', titulo: 'Nuevo' },
  { grupo: 'choca', titulo: 'Choca con lo que hay' },
  { grupo: 'ya_estaba', titulo: 'Ya estaba' },
]

/** Pie con el primario: fijo abajo en el celular mientras hay algo sin entender o sin cargar (§2.5). */
function Pie({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center gap-2 border-t border-[#E2DED5] bg-[#F3F1EC] px-4 py-3 sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0">
      {children}
    </div>
  )
}

export default function CajaSolicitud({
  negocioBloqueId = null,
  contactoId = null,
  compacta = false,
  onCargado,
  onPreguntas,
}: {
  /** Negocio existente: el bloque de la solicitud (lo que se pega suma, nunca borra). */
  negocioBloqueId?: string | null
  /** Negocio nuevo desde la ficha de un contacto: ya se sabe de quién es. */
  contactoId?: string | null
  /** Negocio existente con datos: la caja en una línea, «¿Hay algo nuevo? Pégalo aquí». */
  compacta?: boolean
  onCargado: (r: Extract<RespuestaCargar, { ok: true }>) => void
  /** Las preguntas de los guardianes de la última carga, para «lo que falta». */
  onPreguntas?: (p: PreguntaGuardian[]) => void
}) {
  const nuevo = !negocioBloqueId
  const [abierta, setAbierta] = useState(!compacta)
  const [texto, setTexto] = useState('')
  // La última elección de la persona (§2.2), leída sin romper la hidratación: el servidor no la sabe.
  const quienGuardado = useSyncExternalStore(sinSuscripcion, leerQuien, () => null)
  const [quienElegido, setQuien] = useState<QuienEscribio | null>(null)
  const quien = quienElegido ?? quienGuardado
  const [pendiente, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [entendido, setEntendido] = useState<Entendido | null>(null)
  const [pasarAviso, setPasarAviso] = useState(false)
  const [quitadas, setQuitadas] = useState<Set<string>>(() => new Set())
  const [paso, setPaso] = useState<'resumen' | 'quien'>('resumen')

  const filasCargables = useMemo(
    () => (entendido?.filas ?? []).filter(f => f.grupo !== 'ya_estaba' && !quitadas.has(f.slug)),
    [entendido, quitadas],
  )

  function elegirQuien(q: QuienEscribio) {
    setQuien(q)
    guardarQuien(q)
  }

  function reiniciar(conTexto: boolean) {
    setEntendido(null)
    setPasarAviso(false)
    setQuitadas(new Set())
    setPaso('resumen')
    setError(null)
    if (!conTexto) {
      setTexto('')
      if (compacta) setAbierta(false)
    }
  }

  function entender() {
    if (!texto.trim() || !quien) return
    setError(null)
    startTransition(async () => {
      const r = await entenderSolicitud({ texto, quien, negocioBloqueId, contactoId })
      if (!r.ok) {
        setError(r.error === 'modelo' ? TEXTOS.errorModelo : r.mensaje)
        return
      }
      setEntendido(r)
      setPasarAviso(false)
      setQuitadas(new Set())
      setPaso('resumen')
    })
  }

  function descartar() {
    const id = entendido?.entendimientoId
    reiniciar(false)
    if (id) void descartarSolicitud({ entendimientoId: id, negocioBloqueId })
  }

  function cargar(contacto: ContactoElegido | null, negocio: NegocioElegido | null) {
    if (!entendido) return
    startTransition(async () => {
      const r = await cargarSolicitud({
        entendimientoId: entendido.entendimientoId,
        quitar: [...quitadas],
        negocioBloqueId,
        contacto,
        negocio,
      })
      if (!r.ok) {
        setError(r.mensaje)
        return
      }
      onPreguntas?.(entendido.preguntas)
      reiniciar(false)
      onCargado(r)
    })
  }

  // ── La caja ────────────────────────────────────────────────────────────────

  if (!abierta) {
    return (
      <button
        type="button"
        onClick={() => setAbierta(true)}
        className="w-full rounded-[10px] border-[1.5px] border-dashed border-[#CFCAC0] bg-white px-3 py-2.5 text-left text-[13px] text-[#6E6A62] hover:border-[#0E5C43] hover:bg-[#EAF1EE]"
      >
        {TEXTOS.hayAlgoNuevo}
      </button>
    )
  }

  if (!entendido) {
    const activa = texto.trim() !== ''
    return (
      <div className="space-y-2">
        <div className={`rounded-[10px] border-[1.5px] border-dashed p-3 ${activa ? 'border-[#0E5C43] bg-[#EAF1EE]' : 'border-[#CFCAC0] bg-white'}`}>
          <label htmlFor="caja-solicitud" className="mb-1.5 block text-[13px] font-semibold text-[#191713]">{TEXTOS.rotulo}</label>
          <textarea
            id="caja-solicitud"
            rows={4}
            value={texto}
            disabled={pendiente}
            onChange={e => setTexto(e.target.value)}
            placeholder={TEXTOS.placeholder}
            className={`${INPUT} min-h-[6rem] resize-y [field-sizing:content]`}
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] text-[#191713]">{TEXTOS.quien}</span>
            <button type="button" disabled={pendiente} className={`${quien === 'cliente' ? BTN_ELEGIDO : BTN} min-h-11 sm:min-h-0`} onClick={() => elegirQuien('cliente')}>{TEXTOS.elCliente}</button>
            <button type="button" disabled={pendiente} className={`${quien === 'notas' ? BTN_ELEGIDO : BTN} min-h-11 sm:min-h-0`} onClick={() => elegirQuien('notas')}>{TEXTOS.misNotas}</button>
          </div>
          <p className="mt-1.5 text-[12px] text-[#6E6A62]">{TEXTOS.ayuda}</p>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-[#B3382C]">{error}</p>
        )}
        <Pie>
          <button type="button" className={BTN_PRIM} disabled={!activa || !quien || pendiente} onClick={entender}>
            {pendiente && <span className={SPIN} aria-hidden />}
            {pendiente ? TEXTOS.leyendo : error === TEXTOS.errorModelo ? TEXTOS.reintentar : TEXTOS.entender}
          </button>
          {compacta && !pendiente && (
            <button type="button" className={LINK} onClick={() => reiniciar(false)}>Cerrar</button>
          )}
        </Pie>
      </div>
    )
  }

  // ── Avisos antes del resumen ──────────────────────────────────────────────

  const aviso = entendido.aviso
  if (aviso && !pasarAviso) {
    return (
      <div className="space-y-2 rounded-[10px] border border-[#E9C98F] bg-[#FBF1E2] p-3" role="status">
        <p className="text-[13px] text-[#191713]">{aviso.texto}</p>
        <div className="flex flex-wrap gap-2">
          {aviso.tipo === 'sin_solicitud' && (
            <button type="button" className={BTN} onClick={() => setPasarAviso(true)}>{TEXTOS.esUnViaje}</button>
          )}
          {aviso.tipo === 'cruce' && (
            <button type="button" className={BTN} onClick={() => setPasarAviso(true)}>{TEXTOS.cargarAquiIgual}</button>
          )}
          {aviso.tipo === 'dos_viajes' && (
            <button type="button" className={LINK} onClick={() => reiniciar(true)}>{TEXTOS.corregirTexto}</button>
          )}
          <button type="button" className={BTN} onClick={descartar}>{TEXTOS.descartar}</button>
        </div>
      </div>
    )
  }

  // ── «¿De quién es?» (solo negocio nuevo) ──────────────────────────────────

  if (nuevo && paso === 'quien' && entendido.contacto) {
    return (
      <DeQuien
        decision={entendido.contacto}
        pendiente={pendiente}
        error={error}
        nDatos={filasCargables.length}
        onCargar={cargar}
        onVolver={() => setPaso('resumen')}
      />
    )
  }

  // ── Resumen para confirmar ────────────────────────────────────────────────

  const grupos = nuevo ? [{ grupo: 'nuevo' as const, titulo: '' }] : GRUPOS
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-[#191713]">{entendido.resumen}</p>
      {entendido.preguntas.length > 0 && (
        <ul className="space-y-0.5">
          {entendido.preguntas.map(p => <li key={p.slug} className="text-[13px] text-[#9A5F0C]">{p.texto}</li>)}
        </ul>
      )}
      {grupos.map(({ grupo, titulo }) => {
        const filas = entendido.filas.filter(f => f.grupo === grupo)
        if (filas.length === 0) return null
        return (
          <div key={grupo}>
            {titulo && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#6E6A62]">{titulo}</p>}
            <ul className="divide-y divide-[#E2DED5] rounded-lg border border-[#E2DED5] bg-white">
              {filas.map(f => {
                const fuera = quitadas.has(f.slug)
                return (
                  <li key={f.slug} className={`flex items-start gap-2 px-3 py-2 ${fuera ? 'opacity-45' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-[#191713]">
                        <span className="text-[#6E6A62]">{f.label}:</span>{' '}
                        <span className={fuera ? 'line-through' : 'font-semibold'}>{f.legible}</span>
                        {f.actual && <span className="text-[#6E6A62]">{` (en ONE: ${f.actual})`}</span>}
                      </p>
                      {f.frase && <p className="truncate text-[12px] text-[#6E6A62]">«{f.frase}»</p>}
                    </div>
                    {grupo !== 'ya_estaba' && (
                      <button
                        type="button"
                        className={BTN_X}
                        aria-label={fuera ? `Volver a incluir ${f.label}` : `Quitar ${f.label}`}
                        onClick={() => setQuitadas(prev => {
                          const n = new Set(prev)
                          if (n.has(f.slug)) n.delete(f.slug)
                          else n.add(f.slug)
                          return n
                        })}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      {error && <p role="alert" className="text-[13px] text-[#B3382C]">{error}</p>}
      <Pie>
        {nuevo ? (
          <button type="button" className={BTN_PRIM} disabled={pendiente || filasCargables.length === 0 || !entendido.contacto} onClick={() => setPaso('quien')}>
            {textoBotonCargar(filasCargables.length)}
          </button>
        ) : (
          <button type="button" className={BTN_PRIM} disabled={pendiente || filasCargables.length === 0} onClick={() => cargar(null, null)}>
            {pendiente && <span className={SPIN} aria-hidden />}
            {textoBotonCargar(filasCargables.length)}
          </button>
        )}
        <button type="button" className={LINK} disabled={pendiente} onClick={() => reiniciar(true)}>{TEXTOS.corregirTexto}</button>
        <button type="button" className={BTN} disabled={pendiente} onClick={descartar}>{TEXTOS.descartar}</button>
      </Pie>
    </div>
  )
}

// ── «¿De quién es?» ─────────────────────────────────────────────────────────

function DeQuien({
  decision,
  pendiente,
  error,
  nDatos,
  onCargar,
  onVolver,
}: {
  decision: ContactoDecision
  pendiente: boolean
  error: string | null
  nDatos: number
  onCargar: (c: ContactoElegido, n: NegocioElegido) => void
  onVolver: () => void
}) {
  const inicial: ContactoWeb | null = decision.tipo === 'unico' ? decision.contacto : null
  const [elegido, setElegido] = useState<ContactoWeb | null>(inicial)
  const [otro, setOtro] = useState(decision.tipo === 'ninguno')
  const [nombre, setNombre] = useState(decision.tipo === 'ninguno' ? nombrePropio(decision.nombre) : decision.tipo === 'varios' ? nombrePropio(decision.nombre) : '')
  const [telefono, setTelefono] = useState(decision.tipo === 'ninguno' ? (decision.telefono ?? '') : '')
  const [viaje, setViaje] = useState<string | null>(null)

  const viajes = !otro && elegido ? elegido.viajes : []
  const listo = otro ? nombre.trim() !== '' : !!elegido && (viajes.length === 0 || viaje !== null)

  function crear() {
    if (otro) {
      onCargar({ tipo: 'nuevo', nombre: nombre.trim(), telefono: telefono.trim() || null }, { tipo: 'nuevo' })
    } else if (elegido) {
      onCargar({ tipo: 'existente', id: elegido.id }, viaje && viaje !== 'nuevo' ? { tipo: 'existente', id: viaje } : { tipo: 'nuevo' })
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-[#191713]">¿De quién es?</p>

      {!otro && decision.tipo === 'unico' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-[#191713]">{textoClienteUnico(nombrePropio(decision.contacto.nombre))}</span>
          <button type="button" className={LINK} onClick={() => { setOtro(true); setElegido(null) }}>{TEXTOS.noEsElla}</button>
        </div>
      )}

      {!otro && decision.tipo === 'varios' && (
        <div className="flex flex-wrap gap-1.5">
          {decision.opciones.map(o => (
            <button key={o.id} type="button" className={`${elegido?.id === o.id ? BTN_ELEGIDO : BTN} min-h-11 sm:min-h-0`} onClick={() => { setElegido(o); setViaje(null) }}>
              {nombrePropio(o.nombre)}{o.telefono ? ` · ${o.telefono}` : ''}
            </button>
          ))}
          <button type="button" className={LINK} onClick={() => { setOtro(true); setElegido(null) }}>{TEXTOS.esOtroCliente}</button>
        </div>
      )}

      {otro && (
        <div className="space-y-1.5">
          <p className="text-[13px] font-semibold text-[#191713]">{TEXTOS.clienteNuevo}</p>
          <input className={`${INPUT} max-w-sm`} aria-label="Nombre del cliente" placeholder="Nombre" value={nombre} onChange={e => setNombre(e.target.value)} />
          <input className={`${INPUT} max-w-sm`} aria-label="Celular (opcional)" placeholder="Celular (opcional)" inputMode="tel" value={telefono} onChange={e => setTelefono(e.target.value)} />
        </div>
      )}

      {viajes.length > 0 && elegido && (
        <div className="space-y-1.5">
          <p className="text-[13px] text-[#191713]">
            {viajes.length === 1
              ? textoViajeAbierto(primerNombre(elegido.nombre), viajes[0].nombre)
              : `${primerNombre(elegido.nombre)} tiene viajes abiertos. ¿Es uno de ellos o uno nuevo?`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {viajes.map(v => (
              <button key={v.id} type="button" className={`${viaje === v.id ? BTN_ELEGIDO : BTN} min-h-11 sm:min-h-0`} onClick={() => setViaje(v.id)}>
                {viajes.length === 1 ? TEXTOS.eseViaje : v.nombre}
              </button>
            ))}
            <button type="button" className={`${viaje === 'nuevo' ? BTN_ELEGIDO : BTN} min-h-11 sm:min-h-0`} onClick={() => setViaje('nuevo')}>{TEXTOS.unoNuevo}</button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-[13px] text-[#B3382C]">{error}</p>}
      <Pie>
        <button type="button" className={BTN_PRIM} disabled={!listo || pendiente} onClick={crear}>
          {pendiente && <span className={SPIN} aria-hidden />}
          {viaje && viaje !== 'nuevo' ? textoBotonCargar(nDatos) : TEXTOS.crearYCargar}
        </button>
        <button type="button" className={LINK} disabled={pendiente} onClick={onVolver}>Volver al resumen</button>
      </Pie>
    </div>
  )
}
