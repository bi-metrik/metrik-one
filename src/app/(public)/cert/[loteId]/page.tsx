import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCertPublica } from '@/lib/cert/data'
import type { CertPublica } from '@/lib/cert/types'

export const metadata: Metadata = {
  title: 'Certificación de producto — MéTRIK',
  // Las paginas de certificacion no se indexan (acceso via QR fisico).
  robots: { index: false, follow: false },
}

const C = {
  black: '#1A1A1A',
  gray: '#6B7280',
  green: '#10B981',
  greenDark: '#059669',
  red: '#EF4444',
  amber: '#F59E0B',
  white: '#FFFFFF',
  line: '#E5E7EB',
  bg: '#F5F4F2',
}

function fmtFecha(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })
}

function Lockup() {
  return (
    <span style={{ display: 'inline-flex', position: 'relative', paddingBottom: 8 }}>
      <span style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-0.01em', color: C.black, lineHeight: 1 }}>
        MéTRIK
      </span>
      <span
        style={{
          position: 'absolute', bottom: 0, left: 0, width: '100%',
          height: 2.5, background: C.green, borderRadius: 1,
        }}
      />
    </span>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 12, padding: '20px 18px', marginBottom: 14 }}>
      {children}
    </div>
  )
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: C.green, marginBottom: 12 }}>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: `1px solid #F1F1F0` }}>
      <span style={{ fontSize: 13, color: C.gray }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.black, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

export default async function CertPage({ params }: { params: Promise<{ loteId: string }> }) {
  const { loteId } = await params
  const cert: CertPublica | null = await getCertPublica(loteId)
  if (!cert) notFound()

  const { lote, producto, vigente, diasParaVencer } = cert
  const rango =
    producto?.rango_min_mm && producto?.rango_max_mm
      ? `${producto.rango_min_mm} – ${producto.rango_max_mm} mm`
      : null

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '28px 18px 56px' }}>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <Lockup />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: C.gray }}>
          Certificación
        </span>
      </header>
      <p style={{ fontSize: 13, color: C.gray, marginBottom: 20 }}>
        Certificación de producto elaborada por MéTRIK
        {lote.certificado_para ? ` para ${lote.certificado_para}` : ''}.
      </p>

      {/* Estado de vigencia */}
      <div
        style={{
          background: vigente ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.07)',
          border: `1px solid ${vigente ? C.green : C.red}`,
          borderRadius: 12, padding: '16px 18px', marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 13, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase',
              color: vigente ? C.greenDark : C.red,
            }}
          >
            {vigente ? '● Certificación vigente' : '● Certificación vencida'}
          </span>
        </div>
        <div style={{ fontSize: 13, color: C.gray, marginTop: 6 }}>
          {vigente ? (
            <>Válida hasta el <strong style={{ color: C.black }}>{fmtFecha(lote.fecha_vencimiento)}</strong>
              {typeof diasParaVencer === 'number' && diasParaVencer <= 60 ? (
                <span style={{ color: C.amber, fontWeight: 600 }}> · vence en {diasParaVencer} días</span>
              ) : null}
            </>
          ) : (
            <>Venció el <strong style={{ color: C.black }}>{fmtFecha(lote.fecha_vencimiento)}</strong>. Solicita la recertificación de seguridad
              {lote.certificado_para ? ` a ${lote.certificado_para}` : ''}.</>
          )}
        </div>
      </div>

      {/* Cumplimiento */}
      <Card>
        <CardLabel>Cumplimiento normativo</CardLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span
            style={{
              fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase',
              color: C.white, background: lote.cumple ? C.green : C.red,
              padding: '4px 12px', borderRadius: 100,
            }}
          >
            {lote.cumple ? 'Cumple' : 'No cumple'}
          </span>
          {lote.ratio_critico !== null ? (
            <span style={{ fontSize: 13, color: C.gray }}>
              Ratio crítico <strong style={{ color: C.black }}>{lote.ratio_critico}</strong>
              {lote.ratio_descripcion ? ` · ${lote.ratio_descripcion}` : ''}
            </span>
          ) : null}
        </div>
        <Row label="Norma" value={producto?.norma} />
        <Row label="Criterio" value={producto?.criterio} />
        <Row
          label="Carga de diseño"
          value={producto?.carga_lb ? `${producto.carga_lb} lb${producto.carga_n ? ` (${producto.carga_n} N)` : ''}` : null}
        />
        <Row label="Factor de seguridad" value={producto?.factor_seguridad} />
      </Card>

      {/* Producto */}
      <Card>
        <CardLabel>Producto</CardLabel>
        <Row label="Referencia (SKU)" value={lote.sku} />
        <Row label="Modelo" value={producto?.nombre} />
        <Row label="Tipo" value={producto?.producto_tipo} />
        <Row label="Rango telescópico" value={rango} />
        <Row label="Altura" value={producto?.altura_mm ? `${producto.altura_mm} mm` : null} />
      </Card>

      {/* Material del lote */}
      <Card>
        <CardLabel>Material del lote</CardLabel>
        <Row label="Lote de fabricación" value={lote.numero_lote} />
        <Row label="Opción de material" value={lote.opcion_material} />
        <Row label="Perfil" value={lote.material_perfil} />
        <Row label="Calibre" value={lote.material_calibre} />
        <Row label="Norma de material" value={lote.material_norma} />
        {lote.orientacion_instalacion ? (
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(245,158,11,0.08)', border: `1px solid ${C.amber}`, borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#B45309', marginBottom: 4 }}>
              Orientación de instalación
            </div>
            <div style={{ fontSize: 13, color: C.black }}>{lote.orientacion_instalacion}</div>
          </div>
        ) : null}
      </Card>

      {/* Emisión */}
      <Card>
        <CardLabel>Emisión</CardLabel>
        <Row label="Certificado por" value={lote.certificado_por} />
        <Row label="Certificado para" value={lote.certificado_para} />
        <Row label="Fecha de certificación" value={fmtFecha(lote.fecha_certificacion)} />
        <Row label="Vigencia" value={`${lote.vigencia_meses} meses`} />
      </Card>

      {/* Footer — Powered by MéTRIK */}
      <footer style={{ marginTop: 28, textAlign: 'center' }}>
        <a
          href="https://metrik.com.co"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, textDecoration: 'none' }}
        >
          <span style={{ fontSize: 12, fontWeight: 400, color: C.gray }}>Powered by</span>
          <span style={{ position: 'relative', display: 'inline-flex', paddingBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: C.black, lineHeight: 1 }}>MéTRIK</span>
            <span style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: 1.5, background: C.green, borderRadius: 1 }} />
          </span>
        </a>
        <div style={{ fontSize: 11, color: C.gray, marginTop: 10 }}>
          Verificación de autenticidad · metrik.com.co
        </div>
      </footer>
    </main>
  )
}
