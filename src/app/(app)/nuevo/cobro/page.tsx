import { getFacturasPendientes } from './cobro-action'
import NuevoCobroForm from './nuevo-cobro-form'

export default async function NuevoCobroPage() {
  const facturas = await getFacturasPendientes()
  return <NuevoCobroForm facturas={facturas} />
}
