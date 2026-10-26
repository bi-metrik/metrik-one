'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { Negocio } from '@/lib/funciones/datos'
import { guardarNegocioAction } from '../actions'
import { BotonFijo } from '../panel-ui'

/**
 * Los datos del lugar (P11): se llenan una vez y van en todos los textos. La dirección va en la oferta y en la
 * bienvenida al grupo; el piso, la recepción, el parqueadero y la firma, en la bienvenida. Tal cual, con emojis.
 */
export function LugarCliente({ negocio, puedeEditar }: { negocio: Negocio; puedeEditar: boolean }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  const [v, setV] = useState<Negocio>(negocio)
  const campo = 'mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-base disabled:bg-gray-50'
  const props = (k: keyof Negocio) => ({ value: v[k] ?? '', disabled: !puedeEditar, onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value || null }) })
  const guardar = () =>
    empezar(async () => {
      const r = await guardarNegocioAction(v)
      if (!r.ok) return void toast.error(r.error)
      toast.success('Datos del lugar guardados.')
      router.refresh()
    })
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-28 md:p-6">
      <div>
        <Link href="/funciones" className="text-xs text-[#6B7280] hover:underline">← Funciones</Link>
        <h1 className="text-xl font-semibold text-[#1A1A1A]">Datos del lugar</h1>
        <p className="text-sm text-[#6B7280]">Se escriben una vez y salen en el post, el mensaje directo y la bienvenida al grupo.</p>
      </div>
      <div className="space-y-3 rounded-lg border border-[#E5E7EB] bg-white p-3 text-sm">
        <label className="block">Dirección<input {...props('direccion')} className={`${campo} h-11`} placeholder="AK 9 #104A-50, Bogotá" /></label>
        <label className="block">Piso<input {...props('piso')} className={`${campo} h-11`} placeholder="Segundo piso" /></label>
        <label className="block">
          Recepción <span className="text-xs text-[#6B7280]">(cómo los reciben al llegar; sin el tema de la experiencia, que va en el saludo de cada experiencia)</span>
          <textarea {...props('recepcion')} rows={3} className={campo} placeholder="Al llegar, en el primer piso encontrarán personal de nuestro staff que los recibirá y les indicará por dónde ingresar." />
        </label>
        <label className="block">
          Parqueadero
          <textarea {...props('parqueadero')} rows={4} className={campo} placeholder="Contamos con una bahía de parqueo justo en frente…" />
        </label>
        <label className="block">Firma<input {...props('firma')} className={`${campo} h-11`} placeholder="El equipo de Sabor & Experiencia 🕯️✨" /></label>
        <p className="text-xs text-[#6B7280]">El pago va solo por el link de pago que llega por el chat: no escribas aquí Nequi ni Daviplata.</p>
      </div>
      {puedeEditar && (
        <BotonFijo>
          <button type="button" disabled={pendiente} onClick={guardar} className="h-12 flex-1 rounded-md bg-[#10B981] font-medium text-white disabled:opacity-50">
            Guardar
          </button>
        </BotonFijo>
      )}
    </div>
  )
}
