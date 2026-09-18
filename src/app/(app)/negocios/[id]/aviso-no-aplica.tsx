/**
 * «Este caso no aplica para este proceso», dicho en la ficha.
 *
 * Hermano de `EtapasNoAplican`, y se distingue de él a propósito:
 *
 * · `EtapasNoAplican` es GRIS y describe el estado normal de un caso que tomó una vía
 *   legítima — hay trabajo por hacer, solo que en otras etapas.
 * · Esto es ÁMBAR y describe un caso que **no tiene nada que hacer aquí**. No es un
 *   error del sistema ni una alerta de algo roto, pero sí exige una decisión humana, y
 *   por eso no puede verse igual que lo que está bien.
 *
 * ⚠️ **No tiene botón de cerrar el negocio.** Cerrar tiene motivo, autor y consecuencias
 * financieras, y la respuesta que dispara este aviso se puede corregir en el siguiente
 * clic. El aviso dice qué hacer; la persona decide. (Mismo criterio que el banner de
 * reversa de ruta: propone, no ejecuta.)
 *
 * Lo que sí es obligatorio es el «qué hacer»: un aviso que solo diagnostica deja al
 * operador igual de atascado que la pantalla vacía que vino a reemplazar.
 */

import { Ban } from 'lucide-react'
import type { AvisoNoAplica } from '@/lib/negocios/no-aplica'

export function AvisoNoAplicaPanel({ aviso }: { aviso: AvisoNoAplica | null }) {
  if (!aviso) return null

  return (
    <div
      data-test="aviso-no-aplica"
      className="mt-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <Ban className="mt-0.5 h-4 w-4 shrink-0 text-[#B45309]" />
        <div className="min-w-0 text-[11px] leading-relaxed text-[#92400E]">
          <p data-test="no-aplica-titulo" className="text-[12px] font-semibold text-[#78350F]">
            {aviso.titulo}
          </p>
          <p className="mt-0.5">{aviso.mensaje}</p>
          {aviso.que_hacer && (
            <p className="mt-1 font-medium text-[#78350F]">{aviso.que_hacer}</p>
          )}
        </div>
      </div>
    </div>
  )
}
