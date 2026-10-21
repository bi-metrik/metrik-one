import { redirect } from 'next/navigation'

/** «Hoteles y tours» ahora es «Proveedores» (Mauricio, 2026-10-18): los enlaces guardados siguen sirviendo. */
export default function FotosPage() {
  redirect('/proveedores')
}
