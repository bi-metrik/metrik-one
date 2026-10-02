'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import CajaSolicitud from '@/components/viaje/caja-solicitud'
import { TEXTOS } from '@/lib/negocios/solicitud-texto'

export default function NuevaSolicitud({ contactoId }: { contactoId: string | null }) {
  const router = useRouter()
  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:pb-6">
      <Link href="/negocios" className="mb-3 inline-flex items-center gap-1 text-xs text-[#6E6A62] hover:text-[#191713]">
        <ArrowLeft className="h-3.5 w-3.5" /> Negocios
      </Link>
      <section className="space-y-3 rounded-xl border border-[#E2DED5] bg-[#F3F1EC] p-3 sm:p-4">
        <h1 className="text-base font-semibold text-[#191713]">{TEXTOS.nuevaSolicitud}</h1>
        <CajaSolicitud
          contactoId={contactoId}
          onCargado={r => {
            toast.success(r.mensaje)
            router.push(`/negocios/${r.negocioId}`)
          }}
        />
      </section>
    </div>
  )
}
