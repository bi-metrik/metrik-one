'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { conReintentoDeRed } from '@/lib/red/con-reintento'
import type { VistaAutorizacionContacto } from '@/lib/autorizacion-datos/vista'
import { EstadoAutorizacion, useAccionesAutorizacion } from '@/components/autorizacion-datos/estado-autorizacion'
import {
  cargarAutorizacionDeContacto,
  enviarCorreoAutorizacionDeContacto,
  linkAutorizacionDeContacto,
} from './autorizacion-actions'

/**
 * «Autorización de datos» en la ficha del contacto. La vista llega del servidor con la página
 * (sin un viaje de ida y vuelta extra); solo se recarga tras mandar el correo. La página no la
 * monta si el workspace no usa la autorización.
 */
export default function AutorizacionDatosSection({
  contactoId,
  vistaInicial,
  puedePedir,
}: {
  contactoId: string
  vistaInicial: VistaAutorizacionContacto
  puedePedir: boolean
}) {
  const [vista, setVista] = useState(vistaInicial)

  const acciones = useAccionesAutorizacion({
    link: () => linkAutorizacionDeContacto(contactoId),
    correo: () => enviarCorreoAutorizacionDeContacto(contactoId),
    recargar: () => conReintentoDeRed(() => cargarAutorizacionDeContacto(contactoId)).then(res => {
      if (res.error) toast.error(res.error)
      if (res.vista) setVista(res.vista)
    }),
  })

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Autorización de datos</h2>
      <EstadoAutorizacion vista={vista} alcance="contacto" acciones={puedePedir ? acciones : null} />
    </div>
  )
}
