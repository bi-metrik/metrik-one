'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import DistribuirPagoModal from '@/components/distribuir-pago-modal'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { consultarEpayco, registrarPagoEpayco, type NegocioExistente } from '@/lib/actions/epayco-actions'
import type { EpaycoDesglose } from '@/lib/epayco'
import type { NegocioBloque } from '../../negocio-v2-actions'

export interface PagoRegistrado {
  ref_payco: number
  monto_bruto: number
  pagador_nombre: string
  total_descuentos: number
  monto_neto: number
  tipo_cobro: string
  fecha: string
}

interface BloquePagosEpaycoProps {
  negocioBloqueId: string
  negocioId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  tipoCobro: string // 'anticipo' | 'pago'
  nota?: string // texto guía explícito sobre qué referencia ingresar
  /**
   * Opt-in (config_extra.validar_epayco). Cuando es true:
   *  - bloquea referencias no aprobadas en ePayco (estado != 'Aceptada')
   *  - bloquea referencias ya registradas en otro negocio del workspace,
   *    exigiendo una justificación para forzar el registro.
   * Sin el flag, el bloque se comporta igual que hoy.
   */
  validarEpayco?: boolean
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function BloquePagosEpayco({
  negocioBloqueId,
  negocioId,
  instancia,
  modo,
  tipoCobro,
  nota,
  validarEpayco = false,
}: BloquePagosEpaycoProps) {
  const [pagos, setPagos] = useState<PagoRegistrado[]>(
    () => ((instancia?.data as { pagos?: PagoRegistrado[] } | null)?.pagos) ?? []
  )

  // Re-sincronizar pagos cuando la prop instancia.data cambia (tras revalidatePath).
  // Sin esto, registrar pago actualiza state local pero al re-render del padre
  // con nueva data del server, el state queda desincronizado en algunos browsers
  // y el pago "desaparece" hasta que el usuario refresca manualmente.
  useEffect(() => {
    const dbPagos = ((instancia?.data as { pagos?: PagoRegistrado[] } | null)?.pagos) ?? []
    setPagos(dbPagos)
  }, [instancia?.data])

  const [newRef, setNewRef] = useState('')
  const [previewDesglose, setPreviewDesglose] = useState<EpaycoDesglose | null>(null)
  const [consultando, setConsultando] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Duplicado workspace-wide detectado: requiere justificación para forzar.
  const [duplicado, setDuplicado] = useState<NegocioExistente | null>(null)
  const [justificacion, setJustificacion] = useState('')
  const [showReparto, setShowReparto] = useState(false)
  const router = useRouter()

  const total = pagos.reduce((s, p) => s + p.monto_bruto, 0)

  function resetEstado() {
    setError(null)
    setDuplicado(null)
    setJustificacion('')
    setPreviewDesglose(null)
  }

  async function handleConsultar() {
    if (!newRef.trim()) return
    setConsultando(true)
    resetEstado()
    try {
      const result = await consultarEpayco(newRef.trim(), validarEpayco)
      if (!result.success) {
        setError(result.error)
        if (result.code === 'referencia_duplicada' && result.negocio_existente) {
          // Aún tenemos que mostrar el preview para registrar con override,
          // pero consultarEpayco no devolvió el desglose (cortó en el dup).
          // Marcamos el duplicado; el desglose se obtiene en el registro con
          // override (el server re-consulta ePayco).
          setDuplicado(result.negocio_existente)
        }
      } else {
        // Check if already registered en este mismo bloque
        if (pagos.some(p => p.ref_payco === result.data.ref_payco)) {
          setError('Este pago ya está registrado en este negocio.')
        } else {
          setPreviewDesglose(result.data)
        }
      }
    } catch {
      setError('Error consultando ePayco')
    } finally {
      setConsultando(false)
    }
  }

  function handleRegistrar() {
    if (!previewDesglose) return
    startTransition(async () => {
      const result = await registrarPagoEpayco(negocioBloqueId, negocioId, previewDesglose, tipoCobro, {
        validarEpayco,
      })
      if (!result.success) {
        toast.error(result.error)
        if (result.code === 'referencia_duplicada' && result.negocio_existente) {
          setDuplicado(result.negocio_existente)
          setError(result.error)
        }
      } else {
        setPagos(result.pagos)
        resetEstado()
        setNewRef('')
        toast.success('Pago registrado')
      }
    })
  }

  // Override: registrar una referencia duplicada con justificación obligatoria.
  function handleRegistrarConJustificacion() {
    if (!duplicado) return
    const just = justificacion.trim()
    if (!just) {
      toast.error('Escribe una justificación para registrar la referencia duplicada.')
      return
    }
    const ref = parseInt(newRef.trim(), 10)
    if (isNaN(ref) || ref <= 0) {
      toast.error('Referencia inválida.')
      return
    }
    startTransition(async () => {
      // El server re-consulta ePayco para armar el desglose real; solo necesita
      // el ref_payco para identificar la transacción aprobada.
      const minimalDesglose = { ...(previewDesglose ?? ({} as EpaycoDesglose)), ref_payco: ref }
      const result = await registrarPagoEpayco(negocioBloqueId, negocioId, minimalDesglose as EpaycoDesglose, tipoCobro, {
        validarEpayco,
        justificacion: just,
      })
      if (!result.success) {
        toast.error(result.error)
      } else {
        setPagos(result.pagos)
        resetEstado()
        setNewRef('')
        toast.success('Pago registrado con justificación')
      }
    })
  }

  // ── Modo visible ────────────────────────────────────────────────────────────
  if (modo === 'visible') {
    return (
      <div className="space-y-1.5">
        {pagos.length === 0 && <p className="text-xs text-[#6B7280] italic">Sin pagos registrados</p>}
        {pagos.map((p, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] p-2.5">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[#1A1A1A]">Ref: {p.ref_payco}</p>
              <p className="text-[10px] text-[#6B7280]">{p.pagador_nombre}</p>
            </div>
            <span className="text-xs font-semibold text-[#1A1A1A] tabular-nums shrink-0">
              {fmt(p.monto_bruto)}
            </span>
          </div>
        ))}
        {pagos.length > 0 && (
          <div className="rounded-lg bg-slate-50 border border-slate-100 p-2 text-center">
            <p className="text-[10px] text-[#6B7280] font-medium">{pagos.length} pago{pagos.length > 1 ? 's' : ''}</p>
            <p className="text-sm font-bold text-[#1A1A1A] tabular-nums">
              {fmt(total)}
            </p>
          </div>
        )}
      </div>
    )
  }

  // ── Modo editable ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Existing payments list */}
      {pagos.length > 0 && (
        <div className="space-y-1.5">
          {pagos.map((p, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[#1A1A1A]">Ref: {p.ref_payco}</span>
                  <span className="rounded bg-[#F0FDF4] px-1.5 py-0.5 text-[9px] font-medium text-[#10B981] border border-[#BBF7D0]">
                    verificado
                  </span>
                </div>
                <p className="text-[10px] text-[#6B7280] mt-0.5">{p.pagador_nombre}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-semibold text-[#1A1A1A] tabular-nums">{fmt(p.monto_bruto)}</p>
                <p className="text-[10px] text-[#6B7280] tabular-nums">Neto: {fmt(p.monto_neto)}</p>
              </div>
            </div>
          ))}

          {/* Total bar */}
          <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5 flex items-center justify-between">
            <span className="text-[10px] text-[#6B7280] font-medium">{pagos.length} pago{pagos.length > 1 ? 's' : ''} registrado{pagos.length > 1 ? 's' : ''}</span>
            <span className="text-sm font-bold text-[#1A1A1A] tabular-nums">{fmt(total)}</span>
          </div>
        </div>
      )}

      {/* New payment section */}
      <div className="border-t border-[#E5E7EB] pt-3 mt-1">
        <p className="text-[11px] font-medium text-[#6B7280] mb-2">Nuevo pago</p>
        {nota && (
          <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
            {nota}
          </div>
        )}
        <div className="flex gap-2">
          <div className="flex-1">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={9}
              value={newRef}
              onChange={e => {
                const v = e.target.value.replace(/\D/g, '')
                if (v.length <= 9) setNewRef(v)
              }}
              placeholder="Ej: 344799998"
              disabled={consultando || isPending}
              className={`w-full rounded-lg border bg-white px-3 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-60 ${
                newRef.length > 0 && newRef.length !== 9
                  ? 'border-amber-400 focus:border-amber-400'
                  : 'border-[#E5E7EB] focus:border-[#10B981]'
              }`}
            />
            <p className="mt-1 text-[10px] text-[#6B7280]">
              La referencia debe tener 9 digitos{newRef.length > 0 && newRef.length !== 9 && (
                <span className="text-amber-600 font-medium"> ({newRef.length}/9)</span>
              )}
            </p>
          </div>
          <button
            onClick={handleConsultar}
            disabled={consultando || newRef.length !== 9}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#3B82F6] px-3 py-2 text-[10px] font-medium text-white hover:bg-[#2563EB] disabled:opacity-60 transition-colors whitespace-nowrap self-start"
          >
            {consultando ? 'Consultando...' : <><Search className="h-3 w-3" />Consultar</>}
          </button>
        </div>
      </div>

      {/* Error / alerta (estado no aprobado, referencia inexistente, etc.) */}
      {error && !duplicado && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-medium text-red-700">
          {error}
        </div>
      )}

      {/* Duplicado workspace-wide → bloqueo con override por justificación */}
      {duplicado && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
          <p className="text-[11px] font-semibold text-amber-900">Referencia ya registrada</p>
          <p className="text-[11px] leading-relaxed text-amber-900">
            Esta referencia ePayco ya está registrada en el negocio{' '}
            <span className="font-semibold">{duplicado.codigo ?? duplicado.nombre ?? duplicado.negocio_id}</span>
            {duplicado.nombre && duplicado.codigo ? ` (${duplicado.nombre})` : ''}. Para registrarla de
            nuevo, justifica el motivo. Quedará anotado en el historial del negocio.
          </p>
          <textarea
            value={justificacion}
            onChange={e => setJustificacion(e.target.value)}
            placeholder="Justifica por qué registras esta referencia duplicada…"
            rows={2}
            disabled={isPending}
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 disabled:opacity-60"
          />
          <div className="flex gap-2">
            <button
              onClick={handleRegistrarConJustificacion}
              disabled={isPending || !justificacion.trim()}
              className="flex-1 rounded-lg bg-amber-600 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40 transition-colors"
            >
              {isPending ? 'Registrando…' : 'Registrar con justificación'}
            </button>
            <button
              onClick={resetEstado}
              disabled={isPending}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Preview card */}
      {previewDesglose && (
        <div className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3 space-y-1">
          <p className="text-xs font-semibold text-[#10B981]">Transaccion verificada</p>
          <p className="text-xs text-[#1A1A1A]">Pagador: {previewDesglose.pagador_nombre}</p>
          <p className="text-xs text-[#1A1A1A] tabular-nums">Monto: {fmt(previewDesglose.monto_bruto)}</p>
          <p className="text-xs text-[#1A1A1A] tabular-nums">Comision ePayco: -{fmt(previewDesglose.total_descuentos)}</p>
          {(previewDesglose.comision > 0 || previewDesglose.iva_comision > 0 || previewDesglose.retefuente > 0 || previewDesglose.reteica > 0) && (
            <p className="text-[10px] text-[#6B7280] tabular-nums pl-2">
              {[
                previewDesglose.comision > 0 && `Comision: ${fmt(previewDesglose.comision)}`,
                previewDesglose.iva_comision > 0 && `IVA: ${fmt(previewDesglose.iva_comision)}`,
                previewDesglose.retefuente > 0 && `ReteFuente: -${fmt(previewDesglose.retefuente)}`,
                previewDesglose.reteica > 0 && `ReteICA: -${fmt(previewDesglose.reteica)}`,
              ].filter(Boolean).join(' + ')}
            </p>
          )}
          <p className="text-xs font-semibold text-[#1A1A1A] tabular-nums">Neto: {fmt(previewDesglose.monto_neto)}</p>
          <button
            onClick={handleRegistrar}
            disabled={isPending}
            className="w-full mt-2 rounded-lg bg-[#10B981] py-2 text-xs font-semibold text-white hover:bg-[#059669] disabled:opacity-40 transition-colors"
          >
            {isPending ? 'Registrando...' : 'Registrar pago'}
          </button>
          <button
            onClick={() => setShowReparto(true)}
            disabled={isPending}
            className="w-full mt-1.5 rounded-lg border border-[#10B981] py-2 text-xs font-semibold text-[#10B981] hover:bg-[#ECFDF5] disabled:opacity-40 transition-colors"
          >
            ¿El pago cubre varios negocios? Repartir
          </button>
        </div>
      )}
      {showReparto && previewDesglose && (
        <DistribuirPagoModal
          negocioFijado={{ negocio_id: negocioId, codigo: null, nombre: null }}
          referenciaInicial={newRef.trim()}
          totalInicial={previewDesglose.monto_bruto}
          contextoEpayco
          onClose={() => setShowReparto(false)}
          onDone={() => { setShowReparto(false); resetEstado(); setNewRef(''); router.refresh() }}
        />
      )}
    </div>
  )
}
