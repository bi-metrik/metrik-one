'use client'

import type { ReactNode } from 'react'
import { ShieldCheck, ShieldAlert, Copy, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { formatFecha } from '@/lib/dates/bogota'
import { NOMBRE_CASILLA, type ClaveCasilla } from '@/lib/autorizacion-datos/texto'
import {
  CONSECUENCIA_SIN_AUTORIZACION,
  type AlcanceVista,
  type VistaAutorizacionContacto,
} from '@/lib/autorizacion-datos/vista'

/**
 * El estado de la autorización de datos de un contacto: verde si la aprobó, rojo si no (con el
 * motivo y la consecuencia: el viaje no pasa a Cotización). Lo usan el bloque del viaje
 * (`AutorizacionDelContacto`) y la ficha del contacto en el directorio. No hay botón para
 * marcarla a mano (Emilio, pieza 4.4): solo «Copiar link» y «Enviar por correo».
 */

const fecha = (iso: string | null) => (iso ? formatFecha(iso, { day: 'numeric', month: 'short', year: 'numeric' }) ?? '' : '')

export interface AccionesAutorizacion {
  copiar: () => void
  enviarCorreo: () => void
  pendiente: boolean
}

/** «Copiar link» y «Enviar por correo», con sus avisos. Las server actions las pone quien llama. */
export function useAccionesAutorizacion(p: {
  link: () => Promise<{ url: string | null; error: string | null }>
  correo: () => Promise<{ enviadoA: string | null; error: string | null }>
  recargar: () => Promise<unknown>
}): AccionesAutorizacion {
  const [pendiente, startTransition] = useTransitionTolerante()
  return {
    pendiente,
    copiar: () => startTransition(async () => {
      const r = await p.link()
      if (!r.url) { toast.error(r.error ?? 'No se pudo generar el link'); return }
      try {
        await navigator.clipboard.writeText(r.url)
        toast.success('Link copiado. Envíaselo al cliente por WhatsApp.')
      } catch {
        // Sin permiso de portapapeles (iPhone en algunos contextos): se muestra para copiar a mano.
        toast.message(r.url, { duration: 15000 })
      }
    }),
    enviarCorreo: () => startTransition(async () => {
      const r = await p.correo()
      if (r.error) { toast.error(r.error); return }
      toast.success(`Link enviado a ${r.enviadoA}`)
      await p.recargar()
    }),
  }
}

export function EstadoAutorizacion({
  vista,
  alcance,
  acciones,
  children,
}: {
  vista: VistaAutorizacionContacto
  alcance: AlcanceVista
  /** `null`: solo lectura (sin permiso para pedir el link). */
  acciones: AccionesAutorizacion | null
  /** Lo que va debajo: el registro con evidencia, el enlace a la ficha. */
  children?: ReactNode
}) {
  // `autorizada(vista)`, escrito como comparación para que TypeScript angoste la fase de abajo.
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
        {children}
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
      <div className="flex items-start gap-2 rounded-lg border border-alerta/30 bg-alerta/5 px-3 py-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-alerta" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs text-alerta">{titulo}</p>
          <p className="text-xs font-medium text-alerta">{CONSECUENCIA_SIN_AUTORIZACION[alcance]}</p>
          {vista.manualSinEvidencia && (
            <p className="text-[10px] text-alerta">
              Registrada a mano sin evidencia (antes del 2026-10-08){vista.manualSinEvidencia.fecha ? `, el ${fecha(vista.manualSinEvidencia.fecha)}` : ''}: no cuenta. Envíale el link.
            </p>
          )}
          {!vista.textoPublicado && (
            <p className="text-[10px] font-medium text-alerta">
              El texto de la autorización todavía no está publicado: el cliente verá un marcador y no podrá firmar.
            </p>
          )}
        </div>
      </div>
      {acciones && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={acciones.copiar}
            disabled={acciones.pendiente}
            className="inline-flex items-center gap-1.5 rounded-lg bg-acento px-3 py-2 text-xs font-medium text-white hover:bg-acento-hover disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" /> Copiar link
          </button>
          <button
            type="button"
            onClick={acciones.enviarCorreo}
            disabled={acciones.pendiente || !vista.tieneCorreo}
            title={vista.tieneCorreo ? undefined : 'El contacto no tiene correo registrado'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-medium text-tinta hover:bg-slate-50 disabled:opacity-50"
          >
            <Mail className="h-3.5 w-3.5" /> Enviar por correo
          </button>
        </div>
      )}
      {children}
    </div>
  )
}
