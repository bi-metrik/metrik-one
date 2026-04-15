import { redirect } from 'next/navigation'

// Legacy: /proyectos redirige a /negocios (módulo principal)
export default function ProyectosPage() {
  redirect('/negocios')
}
