'use client'

import { useRouter } from 'next/navigation'
import { Copy, Mail } from 'lucide-react'
import { useAccionesAutorizacion } from '@/components/autorizacion-datos/estado-autorizacion'
import { correoAutorizacionDelNegocio, linkAutorizacionDelNegocio } from './autorizacion-negocio-actions'

/**
 * «Falta la autorización de datos» arriba de la ficha del negocio (reunión con Trappvel del
 * 2026-10-22). Desde ese día la autorización ya no frena armar la cotización: frena
 * ENVIARLA y todo lo que viene después (`autorizacion-datos/envio.ts`). Mientras falte, el negocio
 * lo dice aquí, a la vista, para que nadie se entere en el último clic.
 *
 * QA del 2026-10-29 (viaje 07):
 *   · N7-2: con menores en el viaje y la casilla de menores sin marcar, la franja decía «Falta la
 *     autorización de datos del cliente» mientras el bloque mostraba «Aprobada por el titular».
 *     Ahora dice QUÉ falta (`falta`): la de los menores.
 *   · H7-2: el link se pedía «desde el bloque Autorización de datos», que es de Solicitud y no se
 *     ve en Cotización ni en Seguimiento. Ahora la franja misma copia un link nuevo o lo manda por
 *     correo (`autorizacion-negocio-actions.ts`).
 *
 * Sin `negocioId` (o sin permiso), solo el texto, como antes.
 */
export type FaltaAutorizacion = 'sin_contacto' | 'generales' | 'menores'

const TITULO: Record<FaltaAutorizacion, string> = {
  generales: 'Falta la autorización de datos del cliente',
  menores: 'Falta la autorización de los menores del viaje',
  sin_contacto: 'Falta el cliente del negocio para pedir la autorización de datos',
}

const QUE_HACER: Record<FaltaAutorizacion, string> = {
  generales: 'Mándale el link al cliente: cópialo o envíalo por correo.',
  menores: 'El cliente ya autorizó sus datos, pero el viaje lleva menores y falta la casilla de los menores. Mándale un link nuevo y dile que marque la de sus hijos.',
  sin_contacto: 'Asígnale el contacto al negocio y luego pídele la autorización.',
}

export function AvisoAutorizacionPendiente({
  falta = 'generales',
  negocioId = null,
  puedePedir = false,
}: {
  falta?: FaltaAutorizacion
  negocioId?: string | null
  puedePedir?: boolean
}) {
  const conAcciones = !!negocioId && puedePedir && falta !== 'sin_contacto'
  return (
    <div
      role="status"
      className="mb-3 flex flex-col gap-1 rounded-xl border border-[#F0D9B5] bg-[#FBF1E2] px-3 py-2.5 text-[13px] text-[#191713]"
      data-aviso-autorizacion-pendiente
      data-falta={falta}
    >
      <b className="text-[#9A5F0C]">{TITULO[falta]}</b>
      <span>
        Puedes armar y revisar la cotización. No se puede enviar al cliente, aprobar ni seguir a reservas y cobros hasta que el cliente autorice.
      </span>
      <span className="text-xs text-[#6E6A62]">{QUE_HACER[falta]}</span>
      {conAcciones && <AccionesDelAviso negocioId={negocioId} />}
    </div>
  )
}

function AccionesDelAviso({ negocioId }: { negocioId: string }) {
  const router = useRouter()
  const acciones = useAccionesAutorizacion({
    link: () => linkAutorizacionDelNegocio(negocioId),
    correo: () => correoAutorizacionDelNegocio(negocioId),
    recargar: async () => router.refresh(),
  })
  const boton = 'inline-flex items-center gap-1 rounded-md border border-[#F0D9B5] bg-white px-2.5 py-1 text-xs font-medium text-[#9A5F0C] hover:bg-[#FFF8EE] disabled:opacity-60'
  return (
    <div className="mt-1 flex flex-wrap gap-2" data-acciones-autorizacion>
      <button type="button" className={boton} onClick={acciones.copiar} disabled={acciones.pendiente}>
        <Copy className="h-3.5 w-3.5" aria-hidden /> Copiar link nuevo
      </button>
      <button type="button" className={boton} onClick={acciones.enviarCorreo} disabled={acciones.pendiente}>
        <Mail className="h-3.5 w-3.5" aria-hidden /> Enviar por correo
      </button>
    </div>
  )
}
