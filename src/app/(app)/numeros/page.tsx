import { getNumeros } from './actions-v2'
import NumerosV2Client from './numeros-v2-client'

export default async function NumerosPage() {
  const data = await getNumeros()

  return <NumerosV2Client initialData={data} />
}
