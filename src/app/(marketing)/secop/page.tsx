import type { Metadata } from 'next'
import RegistroSecopClient from './registro-client'

/**
 * Registro público de ONE SECOP. Vive en el DOMINIO BASE (`metrikone.co/secop`), no en un
 * subdominio: cuando alguien llega aquí todavía no tiene espacio, así que no hay subdominio al que
 * llegar. El subdominio lo estrena al final, cuando la ruta de servidor ya creó el espacio.
 *
 * Es la única puerta de autoservicio de ONE, y solo para SECOP: los demás espacios los sigue
 * configurando MéTRIK a mano (spec §0-bis). `/registro` sigue cerrado y redirigiendo a `/login`.
 */

export const metadata: Metadata = {
  title: 'Abre tu espacio — Radar SECOP',
  description:
    'Las convocatorias públicas del SECOP II cruzadas con lo que tu empresa hace. Cinco días de prueba.',
}

export default function RegistroSecopPage() {
  return <RegistroSecopClient />
}
