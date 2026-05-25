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

  const { lote, producto, vigente, diasParaVencer, fabricante, ingeniero } = cert
  const rango =
    producto?.rango_min_mm && producto?.rango_max_mm
      ? `${producto.rango_min_mm} – ${producto.rango_max_mm} mm`
      : null

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '28px 18px 56px' }}>
      {/* Header — fabricante (WMC) */}
      <header style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: C.gray }}>
          Certificado de producto
        </span>
        {fabricante?.logo_url ? (
          <div style={{ marginTop: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fabricante.logo_url}
              alt={fabricante.nombre}
              style={{ height: 56, width: 'auto', maxWidth: '100%', objectFit: 'contain' }}
            />
          </div>
        ) : null}
      </header>
      <p style={{ fontSize: 13, color: C.gray, marginBottom: 20, lineHeight: 1.6 }}>
        Producto fabricado por <strong style={{ color: C.black }}>{fabricante?.nombre ?? lote.certificado_para ?? 'el fabricante'}</strong>,
        con certificación de seguridad estructural emitida por MéTRIK.
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

      {/* Fabricante */}
      {fabricante ? (
        <Card>
          <CardLabel>Fabricante</CardLabel>
          <Row label="Razón social" value={fabricante.nombre} />
          <Row label="NIT" value={fabricante.nit} />
          <Row label="Teléfono" value={fabricante.telefono} />
          <Row label="Correo" value={fabricante.email} />
          <Row label="Ciudad" value={fabricante.ciudad} />
          <Row label="Lote de fabricación" value={lote.numero_lote} />
        </Card>
      ) : null}

      {/* Certificación — firma del ingeniero (lado MéTRIK de la alianza) */}
      <div
        style={{
          background: C.white, border: `1px solid ${C.line}`, borderRadius: 12,
          padding: '22px 18px', marginBottom: 14, borderTop: `3px solid ${C.green}`,
        }}
      >
        <CardLabel>Certificación de seguridad estructural</CardLabel>
        <Row label="Fecha de certificación" value={fmtFecha(lote.fecha_certificacion)} />
        <Row label="Vigencia" value={`${lote.vigencia_meses} meses`} />
        <Row label="Válida hasta" value={fmtFecha(lote.fecha_vencimiento)} />

        <p style={{ fontSize: 13, color: C.gray, margin: '18px 0 14px', lineHeight: 1.6 }}>
          Documento original firmado y certificado por:
        </p>

        {ingeniero ? (
          <div style={{ paddingLeft: 14, borderLeft: `2px solid ${C.green}` }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.black }}>{ingeniero.nombre}</div>
            <div style={{ fontSize: 13, color: C.gray, marginTop: 2 }}>
              {ingeniero.titulo ?? 'Ingeniero Mecánico'}
              {ingeniero.matricula ? ` · Matrícula Profesional ${ingeniero.matricula}` : ''}
            </div>
            {ingeniero.email ? (
              <div style={{ fontSize: 12, color: C.gray, marginTop: 2 }}>{ingeniero.email}</div>
            ) : null}
          </div>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
          <span style={{ fontSize: 12, color: C.gray }}>Certificado por</span>
          <Lockup />
        </div>
        <p style={{ fontSize: 11, color: C.gray, marginTop: 8, lineHeight: 1.5 }}>
          MéTRIK certifica la seguridad estructural; {fabricante?.nombre ?? 'el fabricante'} fabrica el producto.
          Alianza técnica conjunta.
        </p>
      </div>

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
