import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { detalleAutorizacion } from '@/lib/autorizacion-datos/servidor'
import { TextoMd } from '../autorizacion-client'

export const metadata: Metadata = {
  title: 'Detalle de la autorización de datos',
  robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true },
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** El detalle completo (pieza 1b) de la misma versión que muestra el link. */
export default async function DetalleAutorizacionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const d = await detalleAutorizacion(token, (await headers()).get('x-tenant-slug'))
  if (!d) notFound()
  return (
    <main className="mx-auto max-w-2xl p-5">
      <a href={`/autorizacion/${token}`} className="mb-6 inline-block text-sm text-tinta-suave underline">Volver a la autorización</a>
      <TextoMd md={d.detalle} />
    </main>
  )
}
