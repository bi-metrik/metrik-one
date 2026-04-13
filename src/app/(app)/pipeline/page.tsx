import { redirect } from 'next/navigation'

// Legacy: /pipeline redirige a /negocios (módulo principal)
export default function PipelinePage() {
  redirect('/negocios')
}
