import { getPromoters } from './actions'
import PromotoresClient from './promotores-client'

export default async function PromotoresPage() {
  const promoters = await getPromoters()
  return <PromotoresClient promoters={promoters} />
}
