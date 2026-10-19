'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { X, Loader2, Trash2, ArrowRightLeft, Wallet, Search, AlertTriangle, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  editarRepartoComercial,
  prepararRepartoComercial,
  repartirPagoComercial,
  type NegocioParaReparto,
  type RepartoDelNegocio,
} from '@/lib/actions/conciliacion-actions'
import { getNegociosParaPagoFab, type NegocioParaPagoFab } from '@/lib/actions/fab-pago-actions'
import { useIntencion } from '@/hooks/use-intencion'
import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'
import {
  cuadreDelReparto,
  filaSuperaDeuda,
  filasPrellenadas,
  motivosParaNoEnviar,
  sugerenciaPorExceso,
} from '@/lib/cobros/reparto-comercial'

const VERDE = 'var(--acento)'
const FONT = { fontFamily: 'var(--font-schibsted), sans-serif' }

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

interface Fila {
  negocio_id: string
  /** Texto del campo; vacío mientras se escribe. */
  monto: string
  debe: number | null
}

/**
 * Reparto de UN pago entre varios negocios, propuesto por el comercial.
 *
 * Rediseño del 2026-10-19 (ver `lib/cobros/reparto-comercial.ts` para el porqué medido):
 *   - cada negocio llega con lo que debe hoy y ese es su monto inicial (se puede editar);
 *   - la barra de abajo dice siempre total, repartido y diferencia, y si no cuadra no se
 *     envía;
 *   - «Enviar a financiera» muestra el resumen y NADA se crea hasta «Confirmar envío»;
 *   - con `edicion` corrige un reparto enviado y sin aprobar (reemplazo atómico en el
 *     servidor). Aprobado, el servidor lo rechaza aunque la pantalla se quede abierta.
 *
 * Sin borrador a propósito: lo enviado se corrige con «Editar reparto» hasta que la
 * financiera apruebe. Lo que sí se protege es cerrar el modal con cambios sin enviar.
 */
export default function DistribuirPagoModal({
  onClose,
  onDone,
  negocioFijado,
  referenciaInicial,
  totalInicial,
  contextoEpayco = false,
  sugeridosIniciales,
  edicion,
}: {
  onClose: () => void
  onDone: () => void
  /** Negocio desde cuyo bloque se abre: va primero y no se quita. */
  negocioFijado?: { negocio_id: string; codigo: string | null; nombre: string | null }
  /** Referencia ePayco ya consultada (bloque de Pagos): se pre-llena y bloquea. */
  referenciaInicial?: string
  /** Monto real del pago (monto_bruto de ePayco): se pre-llena y bloquea. */
  totalInicial?: number
  /** Abierto desde el bloque de Pagos ePayco: fuente fija ePayco, ref/total en solo-lectura. */
  contextoEpayco?: boolean
  /** Negocios que el aviso «este pago supera lo que debe el caso» propuso agregar. */
  sugeridosIniciales?: string[]
  /** Reparto enviado que se corrige. */
  edicion?: RepartoDelNegocio
}) {
  const intencion = useIntencion()
  const esEdicion = !!edicion
  const [catalogo, setCatalogo] = useState<NegocioParaPagoFab[]>([])
  const [sugeridos, setSugeridos] = useState<NegocioParaReparto[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const fuenteEdicion = edicion?.fuente ?? null
  // Un reparto anterior a la fuente guardada trae `fuente` null: se infiere como lo hace
  // Conciliación (`inferirFuente`), una referencia solo de dígitos es de ePayco.
  const [fuente, setFuente] = useState<'epayco' | 'otra'>(
    !esEdicion || fuenteEdicion === 'epayco' || (!fuenteEdicion && /^\d+$/.test(edicion!.referencia)) ? 'epayco' : 'otra',
  )
  const [fuenteNombre, setFuenteNombre] = useState(esEdicion && fuenteEdicion !== 'epayco' ? (fuenteEdicion ?? '') : '')
  const [referencia, setReferencia] = useState(edicion?.referencia ?? referenciaInicial ?? '')
  const [total, setTotal] = useState(
    edicion ? String(Math.round(edicion.total)) : totalInicial != null ? String(Math.round(totalInicial)) : '',
  )
  const [fecha, setFecha] = useState(edicion?.fecha ?? '')
  const [filas, setFilas] = useState<Fila[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [tocado, setTocado] = useState(false)
  const [pending, startTransition] = useTransitionTolerante()

  const refBloqueada = contextoEpayco || esEdicion
  const totalBloqueado = (contextoEpayco && totalInicial != null) || esEdicion
  const esEpayco = fuente === 'epayco'
  const totalNum = Number(total) || 0

  // Carga: catálogo para buscar + deuda de los negocios iniciales + los del mismo cliente.
  useEffect(() => {
    let cancel = false
    const iniciales = edicion
      ? edicion.porciones.map((p) => p.negocio_id)
      : [negocioFijado?.negocio_id, ...(sugeridosIniciales ?? [])].filter((x): x is string => !!x)
    Promise.all([
      getNegociosParaPagoFab(),
      prepararRepartoComercial({
        negocioIds: iniciales,
        negocioOrigenId: negocioFijado?.negocio_id ?? null,
        referencia: edicion?.referencia ?? null,
      }),
    ]).then(([cat, prep]) => {
      if (cancel) return
      if (cat.error) setLoadError(cat.error)
      setCatalogo(cat.negocios)
      if (!prep.ok) {
        setLoadError(prep.error)
      } else {
        setSugeridos(prep.sugeridos)
        const porId = new Map(prep.negocios.map((n) => [n.negocio_id, n]))
        if (edicion) {
          setFilas(edicion.porciones.map((p) => ({
            negocio_id: p.negocio_id,
            monto: String(Math.round(p.monto)),
            debe: porId.get(p.negocio_id)?.debe ?? null,
          })))
        } else {
          const base = iniciales.map((id) => ({ negocio_id: id, debe: porId.get(id)?.debe ?? null }))
          setFilas(filasPrellenadas(totalNum, base).map((f) => ({ ...f, monto: f.monto > 0 ? String(f.monto) : '' })))
        }
        // Los datos de los negocios iniciales (código, cliente) también van al catálogo.
        setCatalogo((prev) => {
          const ya = new Set(prev.map((n) => n.negocio_id))
          return [...prev, ...[...prep.negocios, ...prep.sugeridos].filter((n) => !ya.has(n.negocio_id))
            .map((n) => ({ negocio_id: n.negocio_id, codigo: n.codigo, nombre: n.nombre, empresa: n.empresa }))]
        })
      }
      setLoading(false)
    })
    return () => { cancel = true }
    // Solo al abrir: el resto lo maneja el comercial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const porId = useMemo(() => new Map(catalogo.map((n) => [n.negocio_id, n])), [catalogo])
  const filasNum = filas.map((f) => ({ negocio_id: f.negocio_id, monto: Number(f.monto) || 0, debe: f.debe }))
  const cuadre = cuadreDelReparto(totalNum, filasNum.map((f) => f.monto))
  const motivos = motivosParaNoEnviar(totalNum, filasNum)
  const usados = new Set(filas.map((f) => f.negocio_id))

  // Aviso «no repartió»: con el origen solo y un pago que supera lo que debe.
  const origen = negocioFijado ? filas.find((f) => f.negocio_id === negocioFijado.negocio_id) : undefined
  const aviso = !esEdicion && origen && filas.length === 1 && totalNum > 0
    ? sugerenciaPorExceso({
        monto: totalNum,
        debeOrigen: origen.debe,
        candidatos: sugeridos.filter((s) => !usados.has(s.negocio_id)).map((s) => ({ ...s, debe: s.debe ?? 0 })),
      })
    : null
  const excedeSinCandidatos = !esEdicion && origen && filas.length === 1 && totalNum > 0 && origen.debe != null
    && totalNum - origen.debe > TOLERANCIA_SALDO_COP && !aviso

  const termino = busqueda.trim().toLowerCase()
  const resultados = termino.length < 2 ? [] : catalogo
    .filter((n) => !usados.has(n.negocio_id))
    .filter((n) => [n.codigo, n.nombre, n.empresa].some((v) => (v ?? '').toLowerCase().includes(termino)))
    .slice(0, 8)
  const sugeridosLibres = sugeridos.filter((s) => !usados.has(s.negocio_id))

  function etiqueta(id: string) {
    const n = porId.get(id)
    return { codigo: n?.codigo ?? (id === negocioFijado?.negocio_id ? negocioFijado?.codigo : null) ?? 'Negocio', cliente: n?.empresa ?? n?.nombre ?? negocioFijado?.nombre ?? '' }
  }

  function setMonto(i: number, v: string) {
    setTocado(true)
    setFilas((prev) => prev.map((f, idx) => (idx === i ? { ...f, monto: v.replace(/[^\d]/g, '') } : f)))
  }

  function quitar(i: number) {
    setTocado(true)
    setFilas((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function agregar(id: string, debeConocido?: number | null) {
    if (usados.has(id)) return
    setTocado(true)
    setBusqueda('')
    let debe = debeConocido ?? null
    if (debeConocido === undefined) {
      setBuscando(true)
      const r = await prepararRepartoComercial({ negocioIds: [id], referencia: edicion?.referencia ?? null })
      setBuscando(false)
      debe = r.ok ? (r.negocios[0]?.debe ?? null) : null
    }
    setFilas((prev) => [...prev, { negocio_id: id, monto: debe && debe > 0 ? String(debe) : '', debe }])
  }

  function cerrar() {
    if (tocado && !pending && !window.confirm('Tienes un reparto sin enviar. ¿Cerrar y descartarlo?')) return
    onClose()
  }

  function pedirConfirmacion() {
    if (!referencia.trim()) return toast.error('Ingresa la referencia del pago')
    if (!esEpayco && !fuenteNombre.trim()) return toast.error('Indica de dónde vino el pago')
    if (motivos.length > 0) return toast.error(motivos[0])
    setConfirmando(true)
  }

  function confirmarEnvio() {
    const input = {
      referencia: referencia.trim(),
      monto_total: totalNum,
      porciones: filasNum.map((f) => ({ negocio_id: f.negocio_id, monto: f.monto })),
      fuente: (esEpayco ? 'epayco' : 'manual') as 'epayco' | 'manual',
      fuente_nombre: esEpayco ? undefined : fuenteNombre.trim(),
      fecha: fecha || undefined,
    }
    startTransition(async () => {
      const res = esEdicion
        ? await editarRepartoComercial(input, intencion.clave())
        : await repartirPagoComercial(input, intencion.clave())
      intencion.cerrar()
      if (res.success) {
        toast.success(esEdicion
          ? 'Reparto corregido. El área financiera recibió el aviso.'
          : filasNum.length > 1 ? 'Reparto enviado. El área financiera lo aprobará.' : 'Pago enviado. El área financiera lo aprobará.')
        onDone()
      } else {
        setConfirmando(false)
        toast.error(res.error)
      }
    })
  }

  const titulo = esEdicion ? 'Editar reparto' : contextoEpayco ? 'Repartir pago entre negocios' : negocioFijado ? 'Registrar pago' : 'Repartir pago entre negocios'

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" style={FONT}>
      <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3" style={{ borderColor: '#E5E7EB' }}>
          <div className="flex items-center gap-2">
            {negocioFijado && !esEdicion ? <Wallet className="h-4 w-4" style={{ color: VERDE }} /> : <ArrowRightLeft className="h-4 w-4" style={{ color: VERDE }} />}
            <h3 className="text-[15px] font-bold" style={{ color: 'var(--tinta)' }}>{confirmando ? 'Confirma el envío' : titulo}</h3>
          </div>
          <button onClick={cerrar} className="rounded p-1 hover:bg-gray-100" aria-label="Cerrar"><X className="h-4 w-4" style={{ color: 'var(--tinta-suave)' }} /></button>
        </div>

        {confirmando ? (
          <Resumen
            referencia={referencia.trim()}
            fuente={esEpayco ? 'ePayco' : fuenteNombre.trim()}
            filas={filasNum.map((f) => ({ ...etiqueta(f.negocio_id), monto: f.monto }))}
            total={totalNum}
            esEdicion={esEdicion}
          />
        ) : (
          <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--tinta-suave)' }}>
              {esEdicion
                ? 'Corrige el reparto mientras el área financiera no lo apruebe. Al guardar reemplaza el anterior y ella recibe el aviso.'
                : 'Cada negocio llega con lo que debe hoy. Ajusta los montos hasta que cuadre con el pago y envíalo al área financiera.'}
            </p>

            {!contextoEpayco && !esEdicion && (
              <Field label="Fuente del pago">
                <div className="grid grid-cols-2 gap-2">
                  {(['epayco', 'otra'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFuente(f)}
                      className="rounded-md border px-2 py-1.5 text-[12px] font-semibold transition"
                      style={fuente === f
                        ? { borderColor: VERDE, color: VERDE, backgroundColor: 'var(--acento-tinte)' }
                        : { borderColor: '#E5E7EB', color: 'var(--tinta-suave)' }}
                    >
                      {f === 'epayco' ? 'ePayco' : 'Otra (manual)'}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {!esEpayco && (
              <Field label="Nombre de la fuente">
                <input value={fuenteNombre} onChange={(e) => { setTocado(true); setFuenteNombre(e.target.value) }} disabled={esEdicion && !!fuenteEdicion} placeholder="ej. Davivienda, Bancolombia, Nequi, efectivo…" className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none disabled:bg-[#F9FAFB]" style={{ borderColor: '#E5E7EB' }} />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label={esEpayco ? 'Referencia ePayco' : 'Referencia / comprobante'}>
                <input
                  value={referencia}
                  onChange={(e) => { setTocado(true); setReferencia(esEpayco ? e.target.value.replace(/[^\d]/g, '') : e.target.value) }}
                  inputMode={esEpayco ? 'numeric' : 'text'}
                  placeholder={esEpayco ? 'ej. 123456789' : 'comprobante'}
                  disabled={refBloqueada}
                  className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none disabled:bg-[#F9FAFB]"
                  style={{ borderColor: '#E5E7EB' }}
                />
              </Field>
              <Field label="Total del pago">
                <input
                  value={total}
                  onChange={(e) => { setTocado(true); setTotal(e.target.value.replace(/[^\d]/g, '')) }}
                  inputMode="numeric"
                  disabled={totalBloqueado}
                  placeholder="0"
                  className="w-full rounded-md border px-2.5 py-1.5 text-right text-[13px] tabular-nums outline-none disabled:bg-[#F9FAFB]"
                  style={{ borderColor: '#E5E7EB' }}
                />
              </Field>
            </div>
            {!esEdicion && (
              <Field label="Fecha del pago">
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#E5E7EB' }} />
              </Field>
            )}
            {esEpayco && !refBloqueada && (
              <p className="-mt-2 text-[11px]" style={{ color: '#9CA3AF' }}>Se valida con ePayco: solo pagos Aceptados, y el total no puede pasar del pago real.</p>
            )}

            {(aviso || excedeSinCandidatos) && origen && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900">
                <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> Este pago supera lo que debe el caso</p>
                <p className="mt-1 leading-relaxed">
                  {etiqueta(origen.negocio_id).codigo} debe {fmtCOP(origen.debe ?? 0)} y el pago es de {fmtCOP(totalNum)}.
                  {aviso ? ' ¿Cubre también otro negocio de este cliente?' : ' ¿Cubre otro negocio? Búscalo abajo y agrégalo.'}
                </p>
                {aviso && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {aviso.candidatos.map((c) => (
                      <button key={c.negocio_id} onClick={() => agregar(c.negocio_id, c.debe)} className="rounded-md border border-amber-400 bg-white px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100">
                        Agregar {c.codigo ?? 'negocio'} · debe {fmtCOP(c.debe)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {loading ? (
              <div className="flex items-center gap-2 px-1 py-1.5 text-[13px]" style={{ color: 'var(--tinta-suave)' }}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando lo que debe cada negocio…
              </div>
            ) : loadError ? (
              <p className="text-[12px]" style={{ color: '#DC2626' }}>{loadError}</p>
            ) : (
              <div className="space-y-2">
                <span className="text-[12px] font-semibold" style={{ color: 'var(--tinta)' }}>Negocios que cubre este pago</span>
                {filas.map((f, i) => {
                  const { codigo, cliente } = etiqueta(f.negocio_id)
                  const supera = filaSuperaDeuda({ negocio_id: f.negocio_id, monto: Number(f.monto) || 0, debe: f.debe })
                  const fija = !esEdicion && f.negocio_id === negocioFijado?.negocio_id
                  return (
                    <div key={f.negocio_id} className={`rounded-lg border p-2.5 ${supera ? 'border-amber-300 bg-amber-50' : 'border-[#E5E7EB] bg-white'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--tinta)' }}>{codigo}</p>
                          {cliente && <p className="truncate text-[11px]" style={{ color: 'var(--tinta-suave)' }}>{cliente}</p>}
                          <p className="text-[11px] tabular-nums" style={{ color: 'var(--tinta-suave)' }}>
                            {f.debe == null ? 'Sin valor cotizado' : `Debe ${fmtCOP(f.debe)}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            value={f.monto}
                            onChange={(e) => setMonto(i, e.target.value)}
                            inputMode="numeric"
                            placeholder="monto"
                            aria-label={`Monto para ${codigo}`}
                            className="w-32 rounded-md border px-2 py-1.5 text-right text-[13px] tabular-nums outline-none"
                            style={{ borderColor: supera ? '#FCD34D' : '#E5E7EB' }}
                          />
                          <button onClick={() => quitar(i)} disabled={fija} title={fija ? 'El negocio de este bloque no se puede quitar' : 'Quitar'} className="rounded p-1 hover:bg-gray-100 disabled:opacity-30">
                            <Trash2 className="h-3.5 w-3.5" style={{ color: 'var(--tinta-suave)' }} />
                          </button>
                        </div>
                      </div>
                      {supera && f.debe != null && (
                        <p className="mt-1 text-[11px] font-medium text-amber-800">Supera lo que debe por {fmtCOP((Number(f.monto) || 0) - f.debe)}</p>
                      )}
                    </div>
                  )
                })}

                {sugeridosLibres.length > 0 && !aviso && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium" style={{ color: 'var(--tinta-suave)' }}>Otros negocios abiertos de este cliente</p>
                    <div className="flex flex-wrap gap-1.5">
                      {sugeridosLibres.map((s) => (
                        <button key={s.negocio_id} onClick={() => agregar(s.negocio_id, s.debe)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold" style={{ borderColor: 'var(--acento-borde)', color: VERDE }}>
                          <Plus className="h-3 w-3" /> {s.codigo ?? 'negocio'} · debe {fmtCOP(s.debe ?? 0)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5" style={{ color: '#9CA3AF' }} />
                  <input
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Agregar negocio: busca por código o cliente"
                    className="w-full rounded-md border py-1.5 pl-8 pr-2.5 text-[13px] outline-none"
                    style={{ borderColor: '#E5E7EB' }}
                  />
                  {buscando && <Loader2 className="absolute right-2.5 top-2 h-3.5 w-3.5 animate-spin" style={{ color: '#9CA3AF' }} />}
                </div>
                {resultados.length > 0 && (
                  <ul className="divide-y rounded-md border" style={{ borderColor: '#E5E7EB' }}>
                    {resultados.map((n) => (
                      <li key={n.negocio_id}>
                        <button onClick={() => agregar(n.negocio_id)} className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-gray-50">
                          <span className="min-w-0">
                            <span className="text-[12px] font-semibold" style={{ color: 'var(--tinta)' }}>{n.codigo ?? 'Negocio'}</span>
                            <span className="ml-1 truncate text-[11px]" style={{ color: 'var(--tinta-suave)' }}>{n.empresa ?? n.nombre ?? ''}</span>
                          </span>
                          <Plus className="h-3.5 w-3.5 shrink-0" style={{ color: VERDE }} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {termino.length >= 2 && resultados.length === 0 && (
                  <p className="text-[11px]" style={{ color: '#9CA3AF' }}>Ningún negocio abierto coincide.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Barra fija: el estado del cuadre siempre a la vista. */}
        <div className="shrink-0 border-t px-5 py-3" style={{ borderColor: '#E5E7EB' }}>
          {!confirmando && (
            <div className="mb-2 grid grid-cols-3 gap-2 text-[11px]" style={{ color: 'var(--tinta-suave)' }}>
              <div><p>Pago</p><p className="text-[13px] font-semibold tabular-nums" style={{ color: 'var(--tinta)' }}>{fmtCOP(totalNum)}</p></div>
              <div><p>Repartido</p><p className="text-[13px] font-semibold tabular-nums" style={{ color: 'var(--tinta)' }}>{fmtCOP(cuadre.repartido)}</p></div>
              <div className="text-right">
                <p>Diferencia</p>
                <p className={`text-[13px] font-bold tabular-nums ${cuadre.estado === 'cuadra' ? '' : 'text-red-600'}`} style={cuadre.estado === 'cuadra' ? { color: VERDE } : undefined}>
                  {totalNum > 0 ? cuadre.texto : '—'}
                </p>
              </div>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            {confirmando ? (
              <>
                <button onClick={() => setConfirmando(false)} disabled={pending} className="rounded-md px-3 py-1.5 text-[13px] font-semibold" style={{ color: 'var(--tinta-suave)' }}>Volver a editar</button>
                <button onClick={confirmarEnvio} disabled={pending} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: VERDE }}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar envío
                </button>
              </>
            ) : (
              <>
                <button onClick={cerrar} className="rounded-md px-3 py-1.5 text-[13px] font-semibold" style={{ color: 'var(--tinta-suave)' }}>Cancelar</button>
                <button
                  onClick={pedirConfirmacion}
                  disabled={loading || motivos.length > 0}
                  title={motivos[0]}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: VERDE }}
                >
                  {esEdicion ? 'Guardar corrección' : 'Enviar a financiera'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Resumen({ referencia, fuente, filas, total, esEdicion }: {
  referencia: string
  fuente: string
  filas: Array<{ codigo: string; cliente: string; monto: number }>
  total: number
  esEdicion: boolean
}) {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
      <p className="text-[12px] leading-relaxed" style={{ color: 'var(--tinta-suave)' }}>
        {esEdicion
          ? 'Este reparto reemplaza el que enviaste. Revisa antes de confirmar.'
          : 'Revisa antes de confirmar. Hasta que confirmes no se registra nada.'}
      </p>
      <p className="text-[12px]" style={{ color: 'var(--tinta)' }}>Ref <span className="font-semibold">{referencia}</span> · {fuente}</p>
      <ul className="divide-y rounded-lg border" style={{ borderColor: '#E5E7EB' }}>
        {filas.map((f) => (
          <li key={f.codigo} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold" style={{ color: 'var(--tinta)' }}>{f.codigo}</span>
              {f.cliente && <span className="block truncate text-[11px]" style={{ color: 'var(--tinta-suave)' }}>{f.cliente}</span>}
            </span>
            <span className="text-[13px] font-semibold tabular-nums" style={{ color: 'var(--tinta)' }}>{fmtCOP(f.monto)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
        <span className="text-[12px] font-medium" style={{ color: 'var(--tinta-suave)' }}>Total</span>
        <span className="text-[14px] font-bold tabular-nums" style={{ color: 'var(--tinta)' }}>{fmtCOP(total)}</span>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold" style={{ color: '#374151' }}>{label}</span>
      {children}
    </label>
  )
}
