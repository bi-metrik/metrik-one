import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * La vista de dueño se mudó a `/tableros`.
 *
 * Dinero, embudo de cobro y riesgo son decisiones de dueño de empresa, y ONE ya
 * tenía el sitio para eso. Esta ruta sobrevive como puente porque un enlace
 * viejo o un marcador no tienen por qué encontrarse con un 404, y porque la
 * pantalla se enseñó en reunión con esta URL.
 *
 * El guard de permiso NO vive aquí: vive en `/tableros`, que es quien decide si
 * la pestaña existe para quien entra. Redirigir no concede nada.
 */
export default function DuenoPage() {
  redirect('/tableros')
}
