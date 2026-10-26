'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { conReintentoDeRed } from '@/lib/red/con-reintento'
import { mensajeDeFallaDeCarga } from '@/lib/red/error-de-red'
import { NOMBRE_CASILLA, MEDIOS_EVIDENCIA, type MedioEvidencia } from '@/lib/autorizacion-datos/texto'
import { autorizada, type VersionEvidencia } from '@/lib/autorizacion-datos/vista'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { EstadoAutorizacion, useAccionesAutorizacion } from '@/components/autorizacion-datos/estado-autorizacion'
import {
  cargarAutorizacionContacto,
  enviarCorreoAutorizacionContacto,
  linkAutorizacionContacto,
  registrarAutorizacionConEvidencia,
  type VistaAutorizacionBloque,
} from './contacto-actions'

/**
 * El estado de la autorización de datos del contacto, dentro del viaje. La autorización la da el
 * titular en su link: aquí se ve si está aprobada (verde) o no (rojo: el viaje no pasa a
 * Cotización), y se manda el link. La presentación es la misma de la ficha del contacto en el
 * directorio (`EstadoAutorizacion`); aquí solo se suma el registro con evidencia, que pide el viaje.
 * No hay botón para marcarla a mano (Emilio, pieza 4.4).
 */

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

  const acciones = useAccionesAutorizacion({
    link: () => linkAutorizacionContacto(negocioBloqueId),
    correo: () => enviarCorreoAutorizacionContacto(negocioBloqueId),
    recargar,
  })

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

  const editable = modo === 'editable'
  return (
    <EstadoAutorizacion vista={vista} alcance="viaje" acciones={editable ? acciones : null}>
      {editable && !autorizada(vista) && vista.evidencia && (
        <RegistroConEvidencia
          versiones={vista.evidencia.versiones}
          onRegistrar={form => startTransition(async () => {
            const r = await registrarAutorizacionConEvidencia(negocioBloqueId, form)
            if (r.error) { toast.error(r.error); return }
            toast.success('Autorización registrada con su evidencia')
            await recargar()
          })}
          pendiente={isPending || acciones.pendiente}
        />
      )}
      {enlaceFicha}
    </EstadoAutorizacion>
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
  versiones: VersionEvidencia[]
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
