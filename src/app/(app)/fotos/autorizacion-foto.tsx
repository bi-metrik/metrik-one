'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { esDeAgenciaDeViajes, MENSAJE_AGENCIA } from '@/lib/fotos/agencias'
import { MAX_PROCEDENCIA, TEXTO_CASILLA_AUTORIZACION, type PedidoAutorizacion } from '@/lib/fotos/autorizacion'
import { CATEGORIAS, NOMBRE_CATEGORIA, type CategoriaFoto } from '@/lib/fotos/categoria'

/**
 * Antes de guardar una foto subida o pegada (Emilio, 2026-10-16): la persona ve la foto, marca
 * «Tengo autorización para usar esta foto» (sin marcarla no se guarda) y, si quiere, dice de dónde
 * viene. El servidor vuelve a revisar la casilla y pone quién y cuándo. En un hotel, además, puede
 * decir qué muestra (fachada, habitación…): opcional, no frena el guardado.
 */
export function AutorizacionFoto({
  archivo,
  guardando,
  onConfirmar,
  onCancelar,
  destino,
  conCategoria = false,
}: {
  archivo: Blob
  guardando: boolean
  onConfirmar: (permiso: PedidoAutorizacion, categoria: CategoriaFoto | null) => void
  onCancelar: () => void
  /** «Queda en el perfil de Catalonia Puerta del Sol»… */
  destino?: string
  /** Hotel: ofrece «¿Qué muestra?». */
  conCategoria?: boolean
}) {
  // Quien la abre la desmonta al guardar o cancelar: cada foto empieza con la casilla sin marcar.
  const vista = useMemo(() => URL.createObjectURL(archivo), [archivo])
  useEffect(() => () => URL.revokeObjectURL(vista), [vista])
  const [marcada, setMarcada] = useState(false)
  const [procedencia, setProcedencia] = useState('')
  const [categoria, setCategoria] = useState<CategoriaFoto | null>(null)

  const deAgencia = esDeAgenciaDeViajes(procedencia)

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row"
      data-autorizacion-foto
      onSubmit={(e) => {
        e.preventDefault()
        if (marcada && !deAgencia && !guardando) onConfirmar({ autorizada: true, procedencia: procedencia.trim() || null }, categoria)
      }}
    >
      <div
        className="aspect-[4/3] w-full shrink-0 rounded-md bg-muted bg-cover bg-center sm:w-44"
        style={vista ? { backgroundImage: `url(${JSON.stringify(vista)})` } : undefined}
        role="img"
        aria-label="La foto que vas a subir"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="inline-flex items-center gap-1 text-xs font-semibold">
          <ShieldCheck className="h-3.5 w-3.5 text-[#0071C2]" /> Antes de guardarla
        </p>
        <label className="flex cursor-pointer items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={marcada}
            onChange={(e) => setMarcada(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#0071C2]"
            required
            data-casilla-autorizacion
          />
          <span>
            <span className="font-medium">{TEXTO_CASILLA_AUTORIZACION}</span>
            <span className="block text-[11px] text-muted-foreground">
              El hotel o quien la tomó te dio permiso. Las fotos de Booking, Expedia, Despegar u otras agencias en línea no se pueden usar.
            </span>
          </span>
        </label>
        <label className="text-[11px] text-muted-foreground">
          ¿De dónde viene? (opcional)
          <input
            value={procedencia}
            onChange={(e) => setProcedencia(e.target.value)}
            maxLength={MAX_PROCEDENCIA}
            placeholder="Kit de medios del hotel, mayorista…"
            className="mt-0.5 h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground"
            data-procedencia
          />
        </label>
        {conCategoria && (
          <div className="text-[11px] text-muted-foreground" role="group" aria-label="¿Qué muestra?">
            ¿Qué muestra? (opcional)
            <div className="mt-0.5 flex flex-wrap gap-1">
              {CATEGORIAS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={categoria === c}
                  onClick={() => setCategoria(categoria === c ? null : c)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${categoria === c ? 'border-[#0071C2] bg-[#0071C2] text-white' : 'text-foreground hover:bg-accent'}`}
                  data-categoria={c}
                >
                  {NOMBRE_CATEGORIA[c]}
                </button>
              ))}
            </div>
          </div>
        )}
        {deAgencia && <p className="text-[11px] text-red-700">{MENSAJE_AGENCIA}</p>}
        <div className="mt-auto flex flex-wrap items-center justify-end gap-2">
          {destino && <span className="mr-auto text-[11px] text-muted-foreground">{destino}</span>}
          <button type="button" onClick={onCancelar} disabled={guardando} className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!marcada || deAgencia || guardando}
            className="inline-flex items-center gap-1 rounded-md bg-[#0071C2] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#005EA6] disabled:opacity-50"
          >
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar foto
          </button>
        </div>
      </div>
    </form>
  )
}

/** La misma casilla en su propia ventana (la tarjeta del hotel o del tour en la cotización). */
export function DialogoAutorizacionFoto({
  archivo,
  guardando,
  onConfirmar,
  onCancelar,
  conCategoria = false,
  nombre,
}: {
  archivo: Blob | null
  guardando: boolean
  onConfirmar: (permiso: PedidoAutorizacion, categoria: CategoriaFoto | null) => void
  onCancelar: () => void
  conCategoria?: boolean
  /** El hotel o el tour: «Queda en el perfil de …». */
  nombre?: string
}) {
  return (
    <Dialog open={archivo !== null} onOpenChange={(v) => !v && !guardando && onCancelar()}>
      <DialogContent className="gap-3 sm:max-w-xl">
        <div className="space-y-0.5 pr-6">
          <DialogTitle className="text-base">Subir una foto</DialogTitle>
          <DialogDescription className="text-xs">
            {nombre ? `Queda en el perfil de ${nombre} y sale sola en las propuestas.` : 'Queda en la biblioteca del espacio y sale sola en las propuestas.'}
          </DialogDescription>
        </div>
        {archivo && <AutorizacionFoto archivo={archivo} guardando={guardando} onConfirmar={onConfirmar} onCancelar={onCancelar} conCategoria={conCategoria} />}
      </DialogContent>
    </Dialog>
  )
}
