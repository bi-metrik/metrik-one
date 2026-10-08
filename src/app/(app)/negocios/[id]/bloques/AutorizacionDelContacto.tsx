'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ShieldCheck, ShieldAlert, Copy, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { formatFecha } from '@/lib/dates/bogota'
import { conReintentoDeRed } from '@/lib/red/con-reintento'
import { mensajeDeFallaDeCarga } from '@/lib/red/error-de-red'
import { NOMBRE_CASILLA, type ClaveCasilla } from '@/lib/autorizacion-datos/texto'
import {
  cargarAutorizacionContacto,
  enviarCorreoAutorizacionContacto,
  linkAutorizacionContacto,
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
            <p className="text-xs font-medium text-acento">Aprobada por el titular el {fecha(vista.aceptadoAt)}</p>
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
      {enlaceFicha}
    </div>
  )
}
