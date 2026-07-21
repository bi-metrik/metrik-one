import { getContacto, getEmpresaByContacto, getNegociosPorContacto, getInteraccionesPorContacto } from '../../actions'
import { notFound } from 'next/navigation'
import Contacto360 from './contacto-360'

export default async function ContactoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [contacto, empresaVinculada, negocios, interacciones] = await Promise.all([
    getContacto(id),
    getEmpresaByContacto(id),
    getNegociosPorContacto(id),
    getInteraccionesPorContacto(id),
  ])

  if (!contacto) notFound()

  return (
    <Contacto360
      contacto={contacto}
      empresaVinculada={empresaVinculada}
      negocios={negocios}
      interacciones={interacciones}
    />
  )
}
