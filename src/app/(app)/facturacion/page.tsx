import { redirect } from 'next/navigation'

// Facturacion vive dentro de Negocios (tab Cobros). Redirect mantiene bookmarks viejos.
export default function FacturacionPage() {
  redirect('/negocios')
}
