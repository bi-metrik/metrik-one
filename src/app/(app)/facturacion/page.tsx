import { redirect } from 'next/navigation'

// Sprint F: Facturacion now lives inside Proyectos (tab Cobros)
// This redirect preserves bookmarks
export default function FacturacionPage() {
  redirect('/proyectos')
}
