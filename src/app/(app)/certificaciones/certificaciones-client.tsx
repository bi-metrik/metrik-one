'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  crearBorrador, enviarAprobacion, aprobarPublicar, devolverBorrador,
  revocar, recertificar, getQr, subirDatabookLinea,
} from '@/lib/cert/admin'

const C = {
  black: '#1A1A1A', gray: '#6B7280', grayLt: '#9CA3AF', green: '#10B981',
  greenDark: '#059669', red: '#EF4444', redDark: '#B91C1C', amber: '#B45309',
  amberSoft: 'rgba(245,158,11,0.12)', white: '#FFFFFF', line: '#E5E7EB',
  hair: '#F0EFEC', bg: '#F5F4F2',
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Props {
  lotes: any[]
  productos: any[]
  negocios: any[]
  esCertificador: boolean
  databookActual: string | null
}

function fmtFecha(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

type EstadoVis = { key: string; label: string; color: string; soft: string }

function estadoVis(l: any): EstadoVis {
  if (l.estado === 'borrador') return { key: 'borrador', label: 'Borrador', color: C.grayLt, soft: '#F3F4F6' }
  if (l.estado === 'pendiente_aprobacion') return { key: 'pendiente', label: 'Pendiente de firma', color: C.amber, soft: C.amberSoft }
  if (l.estado === 'revocado') return { key: 'revocado', label: 'Revocada', color: C.redDark, soft: 'rgba(239,68,68,0.08)' }
  // publicado → vigencia
  const venc = l.fecha_vencimiento ? new Date(l.fecha_vencimiento + 'T00:00:00').getTime() : null
  const hoy = new Date().setHours(0, 0, 0, 0)
  if (venc !== null && venc < hoy) return { key: 'vencida', label: 'Vencida', color: C.redDark, soft: 'rgba(239,68,68,0.08)' }
  if (venc !== null && (venc - hoy) / 86_400_000 <= 60) {
    const d = Math.ceil((venc - hoy) / 86_400_000)
    return { key: 'por_vencer', label: `Por vencer (${d}d)`, color: C.amber, soft: C.amberSoft }
  }
  return { key: 'vigente', label: 'Vigente', color: C.greenDark, soft: 'rgba(16,185,129,0.10)' }
}

const FILTROS = [
  { k: 'todas', label: 'Todas' },
  { k: 'borrador', label: 'Borrador' },
  { k: 'pendiente', label: 'Pendiente' },
  { k: 'vigente', label: 'Vigente' },
  { k: 'por_vencer', label: 'Por vencer' },
  { k: 'vencida', label: 'Vencida' },
]

export default function CertificacionesClient({ lotes, productos, negocios, esCertificador, databookActual }: Props) {
  const [filtro, setFiltro] = useState('todas')
  const [showForm, setShowForm] = useState(false)
  const [pending, start] = useTransition()
  const [qr, setQr] = useState<{ svg: string; png: string; url: string; lote: string } | null>(null)
  const [dbFile, setDbFile] = useState<File | null>(null)

  function subirDb() {
    if (!dbFile) { toast.error('Selecciona un PDF'); return }
    const fd = new FormData(); fd.append('file', dbFile)
    start(async () => {
      try { await subirDatabookLinea(fd); toast.success('DataBook actualizado'); setDbFile(null) }
      catch (e) { toast.error(e instanceof Error ? e.message : 'Error') }
    })
  }

  // form
  const [productoId, setProductoId] = useState('')
  const [negocioId, setNegocioId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [ubicacion, setUbicacion] = useState('')
  const [numeroContrato, setNumeroContrato] = useState('')

  const productoSel = productos.find((p) => p.id === productoId)
  const material = productoSel?.ficha?.material as { perfil?: string; calibre?: string; ratio?: number } | undefined

  const conVis = lotes.map((l) => ({ ...l, _vis: estadoVis(l) }))
  const visibles = filtro === 'todas' ? conVis : conVis.filter((l) => l._vis.key === filtro)
  const pendientesFirma = conVis.filter((l) => l._vis.key === 'pendiente')
  const porVencer = conVis.filter((l) => l._vis.key === 'por_vencer' || l._vis.key === 'vencida')

  function run(fn: () => Promise<void>, ok: string) {
    start(async () => {
      try { await fn(); toast.success(ok) }
      catch (e) { toast.error(e instanceof Error ? e.message : 'Error') }
    })
  }

  function submitBorrador() {
    if (!productoId || !negocioId || !cantidad) {
      toast.error('Completa producto, negocio y cantidad'); return
    }
    start(async () => {
      try {
        await crearBorrador({
          negocio_id: negocioId,
          cert_producto_id: productoId,
          cantidad: Number(cantidad),
          ubicacion: ubicacion || null,
          numero_contrato: numeroContrato || null,
        })
        toast.success('Borrador guardado')
        setShowForm(false); setProductoId(''); setNegocioId(''); setCantidad(''); setUbicacion(''); setNumeroContrato('')
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Error') }
    })
  }

  async function verQr(l: any) {
    try { const r = await getQr(l.id); setQr({ ...r, lote: l.numero_lote }) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Error') }
  }

  function descargar(nombre: string, contenido: string, tipo: string) {
    const a = document.createElement('a')
    if (tipo === 'svg') {
      a.href = URL.createObjectURL(new Blob([contenido], { type: 'image/svg+xml' }))
    } else { a.href = contenido }
    a.download = nombre
    a.click()
  }

  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: C.gray, display: 'block', marginBottom: 6 }
  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: 10, fontSize: 14, color: C.black, background: C.white }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 60px', fontFamily: 'var(--font-montserrat), system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: C.black, margin: 0 }}>Certificaciones</h1>
        <button onClick={() => setShowForm((v) => !v)} disabled={pending}
          style={{ background: C.black, color: C.white, border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {showForm ? 'Cerrar' : '+ Nueva'}
        </button>
      </div>

      {/* Cola de firma (solo certificador) */}
      {esCertificador && pendientesFirma.length > 0 && (
        <div style={{ background: C.amberSoft, border: `1px solid ${C.amber}`, borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.amber }}>⚠ {pendientesFirma.length} pendiente(s) de tu firma</span>
          <button onClick={() => setFiltro('pendiente')} style={{ marginLeft: 10, fontSize: 12, fontWeight: 600, color: C.amber, background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer' }}>ver</button>
        </div>
      )}
      {porVencer.length > 0 && (
        <div style={{ background: 'rgba(245,158,11,0.06)', border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: C.gray }}>🕒 {porVencer.length} certificación(es) por vencer o vencida(s)</span>
          <button onClick={() => setFiltro('por_vencer')} style={{ marginLeft: 10, fontSize: 12, fontWeight: 600, color: C.amber, background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer' }}>ver</button>
        </div>
      )}

      {/* DataBook de línea — carga (solo certificador) */}
      {esCertificador && (
        <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: C.gray, marginBottom: 8 }}>DataBook de línea</div>
          <div style={{ fontSize: 13, color: C.black, marginBottom: 10 }}>
            {databookActual ? <>Actual: <strong>{databookActual}</strong></> : <span style={{ color: C.grayLt }}>No cargado todavía</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="file" accept="application/pdf" onChange={(e) => setDbFile(e.target.files?.[0] ?? null)} style={{ fontSize: 12 }} />
            <button onClick={subirDb} disabled={pending || !dbFile}
              style={{ padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: C.black, color: C.white, opacity: pending || !dbFile ? 0.6 : 1 }}>
              {pending ? 'Subiendo…' : 'Subir / reemplazar'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: C.grayLt, marginTop: 8 }}>Un solo PDF que aplica a todas las referencias. Se descarga desde el certificado con el número de contrato.</div>
        </div>
      )}

      {/* Formulario nueva */}
      {showForm && (
        <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.black, marginBottom: 14 }}>Nueva certificación</div>
          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <label style={lbl}>Producto</label>
              <select value={productoId} onChange={(e) => setProductoId(e.target.value)} style={inp}>
                <option value="">Selecciona…</option>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.nombre}</option>)}
              </select>
            </div>
            {material && (
              <div style={{ fontSize: 12, color: C.gray, background: C.bg, borderRadius: 10, padding: '11px 13px' }}>
                <div style={{ fontWeight: 700, color: C.black, marginBottom: 3 }}>Material del producto</div>
                {material.perfil && <div style={{ lineHeight: 1.4 }}>{material.perfil}</div>}
                {material.calibre && <div style={{ color: C.grayLt, marginTop: 2 }}>Calibre {material.calibre}</div>}
                {material.ratio != null && <div style={{ color: C.greenDark, fontWeight: 600, marginTop: 3 }}>CUMPLE · ratio {material.ratio}</div>}
              </div>
            )}
            <div>
              <label style={lbl}>Negocio (proyecto)</label>
              <select value={negocioId} onChange={(e) => setNegocioId(e.target.value)} style={inp}>
                <option value="">Selecciona…</option>
                {negocios.map((n) => <option key={n.id} value={n.id}>{n.codigo} — {n.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Cantidad de unidades</label>
              <input value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="180" style={inp} />
              <div style={{ fontSize: 11, color: C.grayLt, marginTop: 6 }}>
                El número de lote se asigna automáticamente por producto (ej. {productoSel?.sku ? `${productoSel.sku}-00X` : 'SKU-00X'}).
              </div>
            </div>
            <div>
              <label style={lbl}>Ubicación / obra (opcional)</label>
              <input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Ej. Torre Norte · Bogotá" style={inp} />
            </div>
            <div>
              <label style={lbl}>N° de contrato</label>
              <input value={numeroContrato} onChange={(e) => setNumeroContrato(e.target.value)} placeholder="Contraseña para descargar el DataBook" style={inp} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => submitBorrador()} disabled={pending}
                style={{ padding: '9px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${C.line}`, background: C.white, color: C.black }}>
                Guardar borrador
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 14 }}>
        {FILTROS.map((f) => (
          <button key={f.k} onClick={() => setFiltro(f.k)}
            style={{ whiteSpace: 'nowrap', padding: '6px 12px', borderRadius: 100, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${filtro === f.k ? C.black : C.line}`, background: filtro === f.k ? C.black : C.white, color: filtro === f.k ? C.white : C.gray }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {visibles.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.grayLt, fontSize: 14, padding: '40px 0' }}>Sin certificaciones</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {visibles.map((l) => {
            const vis = l._vis as EstadoVis
            return (
              <div key={l.id} style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.black }}>
                      {l.numero_lote}
                    </div>
                    <div style={{ fontSize: 12, color: C.gray, marginTop: 3 }}>
                      {l.negocios?.codigo ?? '—'}
                      {l.serie_desde != null ? ` · Serie ${String(l.serie_desde).padStart(4, '0')}–${String(l.serie_hasta).padStart(4, '0')}` : ''}
                      {l.fecha_vencimiento ? ` · vence ${fmtFecha(l.fecha_vencimiento)}` : ''}
                    </div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: vis.color, background: vis.soft, padding: '4px 10px', borderRadius: 100 }}>{vis.label}</span>
                </div>

                {/* Acciones por estado */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {l.estado === 'borrador' && (
                    <ActBtn label="Enviar a aprobación" onClick={() => run(() => enviarAprobacion(l.id), 'Enviado a aprobación')} disabled={pending} primary />
                  )}
                  {l.estado === 'pendiente_aprobacion' && esCertificador && (
                    <>
                      <ActBtn label="Aprobar y publicar" onClick={() => run(() => aprobarPublicar(l.id), 'Publicada')} disabled={pending} primary />
                      <ActBtn label="Devolver" onClick={() => run(() => devolverBorrador(l.id), 'Devuelta a borrador')} disabled={pending} />
                    </>
                  )}
                  {l.estado === 'pendiente_aprobacion' && !esCertificador && (
                    <span style={{ fontSize: 12, color: C.amber }}>Esperando firma del ingeniero</span>
                  )}
                  {l.estado === 'publicado' && (
                    <>
                      <ActBtn label="QR" onClick={() => verQr(l)} disabled={pending} />
                      {l.short_code && <a href={`/c/${l.short_code}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, color: C.greenDark, padding: '7px 12px', textDecoration: 'none', border: `1px solid ${C.line}`, borderRadius: 9 }}>Ver certificado</a>}
                      {esCertificador && (vis.key === 'vencida' || vis.key === 'por_vencer') && (
                        <ActBtn label="Recertificar" onClick={() => run(() => recertificar(l.id), 'Recertificada')} disabled={pending} primary />
                      )}
                      {esCertificador && <ActBtn label="Revocar" onClick={() => run(() => revocar(l.id), 'Revocada')} disabled={pending} danger />}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal QR */}
      {qr && (
        <div onClick={() => setQr(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 16, padding: 24, maxWidth: 360, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.black, marginBottom: 4 }}>QR · {qr.lote}</div>
            <div style={{ fontSize: 11, color: C.grayLt, marginBottom: 14, wordBreak: 'break-all' }}>{qr.url}</div>
            <div style={{ width: 220, height: 220, margin: '0 auto 16px' }} dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => descargar(`${qr.lote}.svg`, qr.svg, 'svg')} style={{ padding: '9px 14px', borderRadius: 10, border: 'none', background: C.black, color: C.white, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Descargar SVG (láser)</button>
              <button onClick={() => descargar(`${qr.lote}.png`, qr.png, 'png')} style={{ padding: '9px 14px', borderRadius: 10, border: `1px solid ${C.line}`, background: C.white, color: C.black, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>PNG</button>
            </div>
            <button onClick={() => setQr(null)} style={{ marginTop: 14, fontSize: 12, color: C.gray, background: 'none', border: 'none', cursor: 'pointer' }}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ActBtn({ label, onClick, disabled, primary, danger }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean; danger?: boolean }) {
  const bg = primary ? '#10B981' : danger ? '#FFFFFF' : '#FFFFFF'
  const color = primary ? '#FFFFFF' : danger ? '#B91C1C' : '#1A1A1A'
  const border = primary ? 'none' : `1px solid ${danger ? 'rgba(239,68,68,0.4)' : '#E5E7EB'}`
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: bg, color, border }}>
      {label}
    </button>
  )
}
