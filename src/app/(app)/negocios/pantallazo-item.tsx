'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, Check, Image as ImageIcon, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  confirmarLecturaDePantallazo,
  leerPantallazoDeItem,
  type PropuestaPantallazo,
  type RechazoPantallazo,
} from '@/app/(app)/negocios/pantallazo-actions'
import { formatCOP } from '@/lib/contacts/constants'
import type { DefinicionRanura } from '@/lib/cotizaciones/ranuras-pantallazo'

/**
 * Cargue de pantallazo de UNA línea, contra el contrato de su ranura.
 *
 * ## Lo que esta pantalla tiene que dejar claro
 *
 *  1. **Qué captura se pide**, ANTES de pegar. El contrato empieza en la instrucción,
 *     no en el rechazo: media captura mal hecha se evita diciendo qué se espera.
 *  2. **Que lo leído es una PROPUESTA** (R-P1). Nada toca el costo hasta que alguien
 *     pulsa Confirmar. Por eso el botón dice qué va a pasar, no «Guardar».
 *  3. **El rechazo con su instrucción**, no con un código. Quien lee está con el
 *     proveedor abierto en otra pestaña: necesita saber qué capturar, no qué falló.
 *
 * ## Por qué la propuesta vive aquí y no en la base
 *
 * `rubros` no tiene columna de «sugerido» y agregarla es una migración que hoy no se
 * puede aplicar. Un rubro sugerido guardado contra una base sin esa columna entra al
 * costo como confirmado, que es justo lo que R-P1 prohíbe. Se sostiene en pantalla:
 * recargar descarta la propuesta y hay que volver a pegar — eso cuesta una captura, lo
 * otro cuesta el margen del viaje.
 */
export default function PantallazoItem({
  itemId,
  ranura,
  onConfirmado,
}: {
  itemId: string
  ranura: DefinicionRanura
  onConfirmado: () => void
}) {
  const [leyendo, setLeyendo] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [propuesta, setPropuesta] = useState<PropuestaPantallazo | null>(null)
  const [rechazo, setRechazo] = useState<RechazoPantallazo | null>(null)
  const [tasa, setTasa] = useState('')
  const [isPending, startTransition] = useTransition()

  const enCOP = (propuesta?.moneda ?? 'COP') === 'COP'
  const tasaNum = Number(tasa.replace(/[^\d.,]/g, '').replace(',', '.'))
  const tasaValida = enCOP || (Number.isFinite(tasaNum) && tasaNum > 0)

  function pegar(e: React.ClipboardEvent) {
    const entrada = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
    if (!entrada) return
    e.preventDefault()
    const archivo = entrada.getAsFile()
    if (!archivo) return

    const lector = new FileReader()
    lector.onload = ev => {
      const dataUrl = ev.target?.result as string
      setPreview(dataUrl)
      setPropuesta(null)
      setRechazo(null)
      setLeyendo(true)
      void (async () => {
        try {
          const r = await leerPantallazoDeItem(itemId, dataUrl)
          if (r.ok) setPropuesta(r)
          else setRechazo(r)
        } finally {
          setLeyendo(false)
        }
      })()
    }
    lector.readAsDataURL(archivo)
  }

  function confirmar() {
    if (!propuesta) return
    startTransition(async () => {
      const r = await confirmarLecturaDePantallazo({
        itemId,
        nombre: propuesta.nombre,
        descripcion: propuesta.descripcion,
        unidad: propuesta.unidad,
        cantidad: propuesta.cantidad,
        moneda: propuesta.moneda,
        tasaCambio: enCOP ? null : tasaNum,
        rubros: propuesta.rubros.map(x => ({
          concepto: x.concepto,
          cantidad: x.cantidad,
          unidad: x.unidad,
          valorUnitario: x.valorUnitario,
        })),
      })
      if (!r.success) { toast.error(r.error ?? 'No se pudo guardar el costo'); return }
      toast.success('Costo cargado. Revisa el margen de la línea.')
      setPropuesta(null)
      setPreview(null)
      setTasa('')
      onConfirmado()
    })
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed p-3">
      <div className="mb-2">
        <p className="text-[11px] font-medium">Pantallazo de {ranura.label.toLowerCase()}</p>
        {/* Qué se pide y qué NO sirve, las dos ANTES de pegar: la mitad del contrato
            que evita la captura equivocada. */}
        <p className="text-[10px] text-muted-foreground">{ranura.queSePide}</p>
        <p className="text-[10px] text-muted-foreground">No sirve: {ranura.queNoSirve}</p>
      </div>

      {/* La zona lleva etiqueta: un recuadro que solo reacciona a Ctrl+V, sin texto
          propio una vez pegada la imagen, no le dice nada a quien navega con teclado
          o lector de pantalla. */}
      <div
        onPaste={pegar}
        tabIndex={0}
        aria-label={`Pegar el pantallazo de ${ranura.label.toLowerCase()}`}
        className="flex min-h-[72px] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed bg-muted/30 p-3 focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        {preview ? (
          <div className="flex flex-col items-center gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL del portapapeles, no optimizable por next/image */}
            <img src={preview} alt="Captura pegada" className="max-h-28 rounded object-contain" />
            {leyendo && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-primary">
                <Loader2 className="h-3 w-3 animate-spin" /> Leyendo la captura…
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <ImageIcon className="h-5 w-5" />
            <span className="text-[11px]">Pega la captura con Ctrl+V / Cmd+V</span>
            <span className="text-[10px]">La imagen no se guarda: solo se lee</span>
          </div>
        )}
      </div>

      {rechazo && (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2.5">
          <p className="flex items-start gap-1.5 text-xs font-medium text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {rechazo.instruccion}
          </p>
          {/* El motivo va abajo y en gris: es el detalle de por qué, no la acción. */}
          <p className="mt-1 pl-5 text-[10px] text-amber-800">{rechazo.motivo}</p>
          <p className="mt-1 pl-5 text-[10px] text-amber-700">No se creó ningún costo.</p>
        </div>
      )}

      {propuesta && (
        <div className="mt-2 space-y-2 rounded-md border bg-background p-2.5">
          <p className="text-[11px] font-medium">
            Esto es una propuesta. Nada entra al costo hasta que confirmes.
          </p>

          {propuesta.avisos.map((a, i) => (
            <p key={i} className="flex items-start gap-1.5 rounded bg-amber-50 p-1.5 text-[10px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {a}
            </p>
          ))}

          {/* Lo leído. Los campos vacíos se muestran vacíos, NUNCA en cero (R-P2). */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
            {propuesta.campos.filter(c => c.valor !== null).map(c => (
              <div key={c.slug} className="min-w-0">
                <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">{c.label}</span>
                <span className="block truncate text-[11px]">
                  {c.valor}
                  {c.alertaRevision && (
                    <span
                      title="Este dato cambia el costo: confírmalo contra la captura"
                      className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-700"
                    >
                      revisar
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {propuesta.campos.some(c => c.valor === null) && (
            <p className="text-[10px] text-muted-foreground">
              Sin leer: {propuesta.campos.filter(c => c.valor === null).map(c => c.label.toLowerCase()).join(', ')}.
              Quedan vacíos, no en cero.
            </p>
          )}

          <div className="rounded border">
            <table className="w-full text-[11px]">
              <thead className="border-b bg-muted/40 text-[9px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-left">Concepto</th>
                  <th className="px-2 py-1 text-right">Cant.</th>
                  <th className="px-2 py-1 text-left">Unidad</th>
                  <th className="px-2 py-1 text-right">Valor unit. ({propuesta.moneda})</th>
                </tr>
              </thead>
              <tbody>
                {propuesta.rubros.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-2 py-1">{r.concepto}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.cantidad}</td>
                    <td className="px-2 py-1">{r.unidad}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {enCOP ? formatCOP(r.valorUnitario) : r.valorUnitario.toLocaleString('es-CO')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!enCOP && (
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
                Tasa de cambio {propuesta.moneda} → COP
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={tasa}
                onChange={e => setTasa(e.target.value)}
                placeholder="ej. 4150"
                aria-label={`Tasa de cambio ${propuesta.moneda} a COP`}
                className="w-40 rounded border bg-background px-2 py-1 text-sm"
              />
              {/* El sistema no tiene fuente de TRM y no la inventa (R-P5). Sin tasa, el
                  servidor rechaza: un costo convertido con una tasa adivinada es un
                  margen adivinado. */}
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                El sistema no consulta la TRM: la escribes tú y queda en el costo.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={isPending || !tasaValida}
              onClick={confirmar}
              title={tasaValida ? undefined : 'Escribe la tasa de cambio para poder confirmar'}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              <Check className="h-3 w-3" />
              Confirmar y cargar el costo
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => { setPropuesta(null); setPreview(null); setTasa('') }}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              <X className="h-3 w-3" />
              Descartar
            </button>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Al confirmar, esto REEMPLAZA los rubros de la línea. El precio lo recalcula el margen.
          </p>
        </div>
      )}
    </div>
  )
}
