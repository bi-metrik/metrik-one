'use client'

import Link from 'next/link'

import { avisoDeTarifario, hoyBogota, type ProveedorDeTarjeta } from '@/lib/proveedores/vigencia'

/**
 * El aviso discreto de la tarjeta de la cotización (Mauricio, 2026-10-18): «Tarifario vencido
 * (hasta dic-2025) · Pide el tarifario 2026 al proveedor · Ver ficha». Informativo: no frena
 * cotizar ni agrega clics. Sin nada que decir (un tarifario cubre el viaje), no pinta nada.
 */
export function AvisoTarifarioTarjeta({
  proveedor,
  fechasViaje,
}: {
  proveedor: ProveedorDeTarjeta
  fechasViaje: { inicio: string | null; fin: string | null } | null | undefined
}) {
  const aviso = avisoDeTarifario(proveedor, fechasViaje, hoyBogota())
  if (!aviso) return null
  return (
    <div className="-mt-1 pb-2.5 pl-[42px] pr-3" data-aviso-tarifario={aviso.tono}>
      <p className={`m-0 text-xs ${aviso.tono === 'ambar' ? 'text-[#9A5F0C]' : 'text-[#6E6A62]'}`}>
        <span className="font-semibold">{aviso.texto}</span>
        <span> · {aviso.accion} · </span>
        <Link href={`/proveedores/${aviso.proveedorId}`} className="underline underline-offset-2" prefetch={false}>
          Ver ficha
        </Link>
      </p>
    </div>
  )
}
