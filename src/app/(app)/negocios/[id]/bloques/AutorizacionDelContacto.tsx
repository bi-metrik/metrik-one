'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ShieldCheck, ShieldAlert, Copy, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { formatFecha } from '@/lib/dates/bogota'
import { conReintentoDeRed } from '@/lib/red/con-reintento'
import { mensajeDeFallaDeCarga } from '@/lib/red/error-de-red'
import { NOMBRE_CASILLA, type ClaveCasilla } from '@/lib/autorizacion-datos/texto'
import { MEDIOS_EVIDENCIA, type MedioEvidencia } from '@/lib/autorizacion-datos/texto'
import { todayBogotaISO } from '@/lib/dates/bogota'
import {
  cargarAutorizacionContacto,
  enviarCorreoAutorizacionContacto,
  linkAutorizacionContacto,
  registrarAutorizacionConEvidencia,
  type VistaAutorizacionBloque,
} from './contacto-actions'

/**
 * El estado de la autorización de datos del contacto, dentro del viaje. La autorización la da el
 * titular en su link: aquí se ve si está pendiente, enviada o aprobada, y se manda el link
 * («Copiar link», «Enviar por correo»). No hay botón para marcarla a mano (Emilio, pieza 4.4).
 */

const fecha = (iso: string | null) => (iso ? formatFecha(iso, { day: 'numeric', month: 'short', year: 'numeric' }) ?? '' : '')

export default function AutorizacionDelContacto({
  negocioBloqueId,
  modo,
  enlaceFicha,
}: {
  negocioBloqueId: string
  modo: 'editable' | 'visible'
  enlaceFicha: ReactNode
}) {
  const [vista, setVista] = useState<VistaAutorizacionBloque | null>(null)
  const [cargando, setCargando] = useState(true)
  const [isPending, startTransition] = useTransitionTolerante()

  function recargar() {
    return conReintentoDeRed(() => cargarAutorizacionContacto(negocioBloqueId)).then(res => {
      setCargando(false)
      if (res.error) toast.error(res.error)
      setVista(res.vista)
    })
  }

  useEffect(() => {
    let vivo = true
    conReintentoDeRed(() => cargarAutorizacionContacto(negocioBloqueId)).then(res => {
      if (!vivo) return
      setCargando(false)
      if (res.error) toast.error(res.error)
      setVista(res.vista)
    }).catch(e => {
      if (!vivo) return
      setCargando(false)
      toast.error(mensajeDeFallaDeCarga(e, 'No se pudo cargar la autorización de datos'))
    })
    return () => { vivo = false }
  }, [negocioBloqueId])

  if (cargando) return <p className="text-xs text-tinta-suave italic">Cargando la autorización de datos…</p>
  if (!vista) return <>{enlaceFicha}</>

  function copiar() {
    startTransition(async () => {
      const r = await linkAutorizacionContacto(negocioBloqueId)
      if (!r.url) { toast.error(r.error ?? 'No se pudo generar el link'); return }
      try {
        await navigator.clipboard.writeText(r.url)
        toast.success('Link copiado. Envíaselo al cliente por WhatsApp.')
      } catch {
        // Sin permiso de portapapeles (iPhone en algunos contextos): se muestra para copiar a mano.
        toast.message(r.url, { duration: 15000 })
      }
    })
  }

  function enviarCorreo() {
    startTransition(async () => {
      const r = await enviarCorreoAutorizacionContacto(negocioBloqueId)
      if (r.error) { toast.error(r.error); return }
      toast.success(`Link enviado a ${r.enviadoA}`)
      await recargar()
    })
  }

  if (vista.fase === 'aprobada') {
    const claves = (Object.keys(NOMBRE_CASILLA) as ClaveCasilla[]).filter(k => vista.casillas?.[k] !== null && vista.casillas?.[k] !== undefined)
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 rounded-lg border border-[#BBF7D0] bg-[var(--acento-tinte)] px-3 py-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-acento" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-acento">
              {vista.via === 'evidencia' ? 'Autorizada por otro medio (con evidencia) el ' : 'Aprobada por el titular el '}
              {fecha(vista.aceptadoAt)}
            </p>
            <p className="text-[10px] text-acento/80">
              Versión {vista.version}
              {vista.versionVigente && vista.versionVigente !== vista.version ? ` · vigente ${vista.versionVigente}` : ''}
            </p>
            <ul className="mt-1 space-y-0.5">
              {claves.map(k => (
                <li key={k} className="text-[10px] text-tinta">
                  {NOMBRE_CASILLA[k]}: {vista.vigente[k] ? 'sí' : vista.casillas?.[k] ? 'revocada' : 'no'}
                </li>
              ))}
            </ul>
            {!vista.vigente.sensibles && (
              <p className="mt-1 text-[10px] font-medium text-[#92400E]">
                Sin autorización de datos sensibles: no registres salud ni creencias.
              </p>
            )}
          </div>
        </div>
        {enlaceFicha}
      </div>
    )
  }

  const titulo = {
    reaceptar: `${vista.contactoNombre} autorizó una versión anterior: hay una versión nueva que pide volver a autorizar.`,
    rechazada: `${vista.contactoNombre} respondió «No autorizo» el ${fecha(vista.rechazadoAt)}.`,
    enviada: `Link enviado por correo el ${fecha(vista.correoEnviadoAt)}. Falta que ${vista.contactoNombre} autorice.`,
    pendiente: `${vista.contactoNombre} no ha autorizado el tratamiento de sus datos.`,
  }[vista.fase]

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#B45309]" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs text-[#92400E]">{titulo}</p>
          {vista.manualSinEvidencia && (
            <p className="text-[10px] text-[#92400E]">
              Registrada a mano sin evidencia (antes del 2026-10-08){vista.manualSinEvidencia.fecha ? `, el ${fecha(vista.manualSinEvidencia.fecha)}` : ''}: no cuenta. Envíale el link.
            </p>
          )}
          {!vista.textoPublicado && (
            <p className="text-[10px] font-medium text-[#92400E]">
              El texto de la autorización todavía no está publicado: el cliente verá un marcador y no podrá firmar.
            </p>
          )}
        </div>
      </div>
      {modo === 'editable' && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copiar}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-acento px-3 py-2 text-xs font-medium text-white hover:bg-acento-hover disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" /> Copiar link
          </button>
          <button
            type="button"
            onClick={enviarCorreo}
            disabled={isPending || !vista.tieneCorreo}
            title={vista.tieneCorreo ? undefined : 'El contacto no tiene correo registrado'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-medium text-tinta hover:bg-slate-50 disabled:opacity-50"
          >
            <Mail className="h-3.5 w-3.5" /> Enviar por correo
          </button>
        </div>
      )}
      {modo === 'editable' && vista.evidencia && (
        <RegistroConEvidencia
          versiones={vista.evidencia.versiones}
          onRegistrar={form => startTransition(async () => {
            const r = await registrarAutorizacionConEvidencia(negocioBloqueId, form)
            if (r.error) { toast.error(r.error); return }
            toast.success('Autorización registrada con su evidencia')
            await recargar()
          })}
          pendiente={isPending}
        />
      )}
      {enlaceFicha}
    </div>
  )
}

/**
 * «Registrar autorización recibida por otro medio» (Emilio, pieza 4.4). Solo con el archivo que la prueba, la fecha en
 * que el cliente autorizó, el medio, la versión que se le mostró y las casillas que cubre. No vale «me dijo por teléfono».
 */
function RegistroConEvidencia({
  versiones,
  onRegistrar,
  pendiente,
}: {
  versiones: Array<{ id: string; version: string; casillas: Array<{ clave: ClaveCasilla; texto: string }> }>
  onRegistrar: (form: FormData) => void
  pendiente: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [textoId, setTextoId] = useState(versiones[0]?.id ?? '')
  if (!versiones.length) return null
  const version = versiones.find(v => v.id === textoId) ?? versiones[0]
  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="text-[11px] text-tinta-suave underline">
        Registrar autorización recibida por otro medio
      </button>
    )
  }
  const input = 'w-full rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs'
  return (
    <form
      className="space-y-2 rounded-lg border border-[#E5E7EB] p-3"
      onSubmit={e => { e.preventDefault(); onRegistrar(new FormData(e.currentTarget)) }}
    >
      <p className="text-[11px] text-tinta-suave">
        Solo con evidencia: el documento firmado o la captura del cliente respondiendo a un mensaje que traía el texto o el link. «Me dijo por teléfono» no vale.
      </p>
      <label className="block text-[11px] font-medium text-tinta-suave">Evidencia (PDF o imagen)
        <input name="archivo" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" className={`${input} mt-1`} />
      </label>
      <label className="block text-[11px] font-medium text-tinta-suave">Medio
        <select name="medio" required className={`${input} mt-1`} defaultValue="">
          <option value="" disabled>Elige</option>
          {(Object.keys(MEDIOS_EVIDENCIA) as MedioEvidencia[]).map(m => <option key={m} value={m}>{MEDIOS_EVIDENCIA[m]}</option>)}
        </select>
      </label>
      <label className="block text-[11px] font-medium text-tinta-suave">Fecha en que el cliente autorizó
        <input name="fecha" type="date" required max={todayBogotaISO()} className={`${input} mt-1`} />
      </label>
      <label className="block text-[11px] font-medium text-tinta-suave">Versión del texto que se le mostró
        <select name="texto_id" value={textoId} onChange={e => setTextoId(e.target.value)} className={`${input} mt-1`}>
          {versiones.map(v => <option key={v.id} value={v.id}>{v.version}</option>)}
        </select>
      </label>
      <fieldset className="space-y-1">
        <legend className="text-[11px] font-medium text-tinta-suave">Qué cubre</legend>
        {version.casillas.map(c => (
          <label key={c.clave} className="flex items-start gap-2 text-[11px] text-tinta">
            <input type="checkbox" name={`casilla_${c.clave}`} required={c.clave === 'generales'} className="mt-0.5" />
            <span><strong>{NOMBRE_CASILLA[c.clave]}.</strong> {c.texto}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex gap-2">
        <button type="button" onClick={() => setAbierto(false)} disabled={pendiente} className="flex-1 rounded-lg border border-[#E5E7EB] py-1.5 text-xs">Cancelar</button>
        <button type="submit" disabled={pendiente} className="flex-1 rounded-lg bg-acento py-1.5 text-xs font-medium text-white disabled:opacity-50">
          {pendiente ? 'Guardando…' : 'Registrar con evidencia'}
        </button>
      </div>
    </form>
  )
}
