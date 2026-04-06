import { getDatosNuevoNegocio } from '../negocio-v2-actions'
import NuevoNegocioForm from './nuevo-negocio-form'

export default async function NuevoNegocioPage() {
  const { lineas } = await getDatosNuevoNegocio()
  return <NuevoNegocioForm lineas={lineas} />
}
