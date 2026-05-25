import { notFound, redirect } from 'next/navigation'
import { getCertIdByShortCode } from '@/lib/cert/data'

// Ruta corta del QR: /c/{codigo} -> resuelve y redirige a /cert/{id}.
// URL corta = QR menos denso = marcado laser confiable en lamina pequeña.
export default async function ShortCertRedirect({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const id = await getCertIdByShortCode(code)
  if (!id) notFound()
  redirect(`/cert/${id}`)
}
