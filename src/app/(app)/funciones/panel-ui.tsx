'use client'

/**
 * Piezas comunes del panel de campañas (§4 del diseño de Noor, revisado por Sofía): primero el celular.
 *   · `Hoja`: la hoja inferior que dice el efecto en palabras llanas antes de una acción que «Confirma».
 *   · `conDeshacer`: la acción de «1 toque» se hace y queda «Deshacer» unos segundos.
 *   · `Insignia`: las palabras de Sabor para la campaña y la función.
 *   · `BotonFijo`: el botón de avanzar, fijo abajo en el celular.
 */
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function Hoja(p: {
  abierta: boolean
  onCerrar: () => void
  titulo: string
  children?: ReactNode
  efecto?: string
  confirmar?: { texto: string; onConfirmar: () => void; peligro?: boolean; pendiente?: boolean }
}) {
  return (
    <Dialog open={p.abierta} onOpenChange={(a) => !a && p.onCerrar()}>
      <DialogContent className="top-auto bottom-0 max-w-full translate-y-0 gap-3 rounded-b-none p-5 sm:top-[50%] sm:bottom-auto sm:max-w-lg sm:translate-y-[-50%] sm:rounded-lg">
        <DialogHeader className="text-left">
          <DialogTitle className="text-base">{p.titulo}</DialogTitle>
          {p.efecto && <DialogDescription className="text-sm text-[#1A1A1A]">{p.efecto}</DialogDescription>}
        </DialogHeader>
        {p.children}
        {p.confirmar && (
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <button type="button" onClick={p.onCerrar} className="h-11 rounded-md border border-[#E5E7EB] px-4 text-sm">
              Volver
            </button>
            <button
              type="button"
              disabled={p.confirmar.pendiente}
              onClick={p.confirmar.onConfirmar}
              className={`h-11 rounded-md px-4 text-sm font-medium text-white disabled:opacity-50 ${p.confirmar.peligro ? 'bg-red-600 hover:bg-red-700' : 'bg-[#10B981] hover:bg-[#059669]'}`}
            >
              {p.confirmar.texto}
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** «1 toque»: la acción ya se hizo; «Deshacer» la revierte durante unos segundos. */
export function conDeshacer(mensaje: string, deshacer: () => Promise<{ ok: boolean; error?: string }>) {
  toast.success(mensaje, {
    duration: 6000,
    action: {
      label: 'Deshacer',
      onClick: async () => {
        const r = await deshacer()
        if (r.ok) toast('Listo, se deshizo.')
        else toast.error(r.error ?? 'No se pudo deshacer.')
      },
    },
  })
}

const COLOR: Record<string, string> = {
  Activa: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Disponible: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Borrador: 'bg-gray-50 text-gray-600 border-gray-200',
  Pausada: 'bg-amber-50 text-amber-700 border-amber-200',
  Cerrada: 'bg-gray-100 text-gray-600 border-gray-200',
  Agotada: 'bg-gray-800 text-white border-gray-800',
  'Llena para el asistente': 'bg-sky-50 text-sky-700 border-sky-200',
  Llena: 'bg-gray-800 text-white border-gray-800',
  Cancelada: 'bg-red-50 text-red-700 border-red-200',
}

export function Insignia({ texto }: { texto: string }) {
  return (
    <Badge variant="outline" className={COLOR[texto] ?? ''}>
      {texto}
    </Badge>
  )
}

/** El botón de avanzar: fijo abajo en el celular, en línea en pantallas grandes. */
export function BotonFijo({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E5E7EB] bg-white/95 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
      <div className="mx-auto flex max-w-3xl gap-2">{children}</div>
    </div>
  )
}

export async function copiar(texto: string, aviso = 'Copiado.') {
  try {
    await navigator.clipboard.writeText(texto)
    toast.success(aviso)
  } catch {
    toast.error('No se pudo copiar: selecciónalo y cópialo a mano.')
  }
}
