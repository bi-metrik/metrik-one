import { getContacto, getEmpresaByContacto, getNegociosPorContacto, getInteraccionesPorContacto, getStaffParaResponsable } from '../../actions'
import { cargarAutorizacionDeContacto } from './autorizacion-actions'
import { cargarPerfilDeContacto } from './perfil-actions'
import { notFound } from 'next/navigation'
import Contacto360 from './contacto-360'
import AutorizacionDatosSection from './autorizacion-datos-section'
import PerfilSection from './perfil-section'

export default async function ContactoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [contacto, empresaVinculada, negocios, interacciones, staff, autorizacion, perfil] = await Promise.all([
    getContacto(id),
    getEmpresaByContacto(id),
    getNegociosPorContacto(id),
    getInteraccionesPorContacto(id),
    getStaffParaResponsable(),
    cargarAutorizacionDeContacto(id),
    cargarPerfilDeContacto(id),
  ])

  if (!contacto) notFound()

  return (
    <Contacto360
      contacto={contacto}
      empresaVinculada={empresaVinculada}
      negocios={negocios}
      interacciones={interacciones}
      staff={staff}
      autorizacion={
        // Solo en workspaces con `config_extra.autorizacion_datos`: sin ella `vista` es null.
        autorizacion.vista ? (
          <AutorizacionDatosSection contactoId={id} vistaInicial={autorizacion.vista} puedePedir={autorizacion.puedePedir} />
        ) : autorizacion.error ? (
          <div className="rounded-lg border border-alerta/30 bg-alerta/5 p-4 text-xs text-alerta">
            Autorización de datos: {autorizacion.error}
          </div>
        ) : null
      }
      perfil={
        // Mismo alcance que la autorización: sin ella no se guarda nada en el perfil.
        perfil.perfil ? (
          <PerfilSection contactoId={id} inicial={perfil.perfil} />
        ) : perfil.error ? (
          <div className="rounded-lg border border-alerta/30 bg-alerta/5 p-4 text-xs text-alerta">
            Perfil: {perfil.error}
          </div>
        ) : null
      }
    />
  )
}
