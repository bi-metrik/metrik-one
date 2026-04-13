import { getContacto, getOportunidadesPorContacto, getEmpresaByContacto, getNegociosPorContacto } from '../../actions'
import { notFound } from 'next/navigation'
import Contacto360 from './contacto-360'

export default async function ContactoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [contacto, oportunidades, empresaVinculada, negocios] = await Promise.all([
    getContacto(id),
    getOportunidadesPorContacto(id),
    getEmpresaByContacto(id),
    getNegociosPorContacto(id),
  ])

  if (!contacto) notFound()

  return <Contacto360 contacto={contacto} oportunidades={oportunidades} empresaVinculada={empresaVinculada} negocios={negocios} />
}
