import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ShieldCheck, ShieldAlert } from 'lucide-react'
import { getCertPublica } from '@/lib/cert/data'
import type { CertPublica } from '@/lib/cert/types'

export const metadata: Metadata = {
  title: 'Certificación de producto',
  robots: { index: false, follow: false },
}

// La vigencia se evalua contra la fecha actual en cada request: nunca cachear,
// para que la certificacion pase a "vencida" en el instante en que expira.
export const dynamic = 'force-dynamic'

const C = {
  black: '#1A1A1A',
  gray: '#6B7280',
  grayLt: '#9CA3AF',
  green: '#10B981',
  greenDark: '#059669',
  red: '#EF4444',
  redDark: '#B91C1C',
  amber: '#B45309',
  white: '#FFFFFF',
  line: '#E5E7EB',
  hair: '#F0EFEC',
  bg: '#F5F4F2',
}

function fmtFecha(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase', color: C.green, marginBottom: 14 }}>
      {children}
    </div>
  )
}

function Spec({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '11px 0', borderTop: `1px solid ${C.hair}` }}>
      <span style={{ fontSize: 13, color: C.gray }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.black, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function Section({ label, children, first }: { label: string; children: React.ReactNode; first?: boolean }) {
  return (
    <section style={{ padding: '26px 0', borderTop: first ? 'none' : `1px solid ${C.line}` }}>
      <Eyebrow>{label}</Eyebrow>
      {children}
    </section>
  )
}

export default async function CertPage({ params }: { params: Promise<{ loteId: string }> }) {
  const { loteId } = await params
  const cert: CertPublica | null = await getCertPublica(loteId)
  if (!cert) notFound()

  const { lote, producto, vigente, diasParaVencer, fabricante, ingeniero, negocioCodigo } = cert
  const pad = (n: number) => String(n).padStart(4, '0')
  const serie =
    lote.serie_desde != null && lote.serie_hasta != null
      ? { rango: `${pad(lote.serie_desde)} – ${pad(lote.serie_hasta)}`, cantidad: lote.serie_hasta - lote.serie_desde + 1 }
      : null
  const idCompuesto = [negocioCodigo, lote.sku, lote.numero_lote].filter(Boolean).join('  ·  ')
  const ficha = producto?.ficha ?? null
  const accent = vigente ? C.green : C.red
  const accentSoft = vigente ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.07)'
  const rango =
    producto?.rango_min_mm && producto?.rango_max_mm
      ? `${producto.rango_min_mm} – ${producto.rango_max_mm} mm`
      : null
  const titulo = producto?.producto_tipo || producto?.nombre || lote.sku
  const subtitulo = [producto?.nombre ? `Modelo ${producto.nombre}` : null, `Ref. ${lote.sku}`]
    .filter(Boolean).join(' · ')

  return (
    <main style={{ maxWidth: 520, margin: '0 auto', padding: '24px 16px 48px' }}>
      <div
        style={{
          background: C.white,
          border: `1px solid ${C.line}`,
          borderRadius: 18,
          boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 12px 32px rgba(16,24,40,0.05)',
          overflow: 'hidden',
        }}
      >
        {/* Barra superior — fabricante (WMC manda en el co-branding) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: `1px solid ${C.hair}` }}>
          {fabricante?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fabricante.logo_url} alt={fabricante.nombre} style={{ height: 75, width: 'auto', maxWidth: 360, objectFit: 'contain' }} />
          ) : <span style={{ fontSize: 14, fontWeight: 700, color: C.black }}>{fabricante?.nombre}</span>}
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: C.grayLt, textAlign: 'right' }}>
            Certificado<br />de producto
          </span>
        </div>

        {/* Hero — el momento de confianza */}
        <div style={{ padding: '36px 24px 30px', textAlign: 'center' }}>
          <div
            style={{
              width: 72, height: 72, borderRadius: '50%', margin: '0 auto 18px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: accentSoft, border: `1.5px solid ${accent}`,
            }}
          >
            {vigente
              ? <ShieldCheck size={34} color={C.greenDark} strokeWidth={1.6} />
              : <ShieldAlert size={34} color={C.red} strokeWidth={1.6} />}
          </div>

          <h1 style={{ fontSize: 26, fontWeight: 300, letterSpacing: '-0.02em', color: C.black, lineHeight: 1.18, margin: 0 }}>
            {titulo}
          </h1>
          {subtitulo ? (
            <p style={{ fontSize: 13, color: C.gray, marginTop: 8 }}>{subtitulo}</p>
          ) : null}

          {/* Estado de vigencia */}
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 18,
              padding: '7px 16px', borderRadius: 100, background: accentSoft,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent, display: 'inline-block' }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.3, color: vigente ? C.greenDark : C.redDark }}>
              {vigente ? 'Certificación vigente' : 'Certificación vencida'}
            </span>
          </div>
          <p style={{ fontSize: 12.5, color: C.gray, marginTop: 12, lineHeight: 1.55 }}>
            {vigente ? (
              <>Válida hasta el <strong style={{ color: C.black, fontWeight: 600 }}>{fmtFecha(lote.fecha_vencimiento)}</strong>
                {typeof diasParaVencer === 'number' && diasParaVencer <= 60
                  ? <span style={{ color: C.amber, fontWeight: 600 }}> · vence en {diasParaVencer} días</span> : null}
              </>
            ) : (
              <>Venció el <strong style={{ color: C.black, fontWeight: 600 }}>{fmtFecha(lote.fecha_vencimiento)}</strong>. Requiere recertificación de seguridad.</>
            )}
          </p>
        </div>

        {/* Cuerpo */}
        <div style={{ padding: '0 24px 8px' }}>
          <Section label="Identificación" first>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.black, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums', lineHeight: 1.4 }}>
              {idCompuesto}
            </div>
            {serie ? (
              <div style={{ fontSize: 13, color: C.gray, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                Serie {serie.rango} · {serie.cantidad} unidades
              </div>
            ) : null}
            <div style={{ fontSize: 11, color: C.grayLt, marginTop: 8 }}>
              Proyecto · Producto · Lote
            </div>
          </Section>

          <Section label="Cumplimiento normativo">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em', color: lote.cumple ? C.greenDark : C.red }}>
                {lote.cumple ? 'Cumple' : 'No cumple'}
              </span>
              <span style={{ fontSize: 13, color: C.gray }}>{producto?.norma}</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <Spec label="Criterio" value={producto?.criterio} />
              <Spec label="Carga de diseño" value={producto?.carga_lb ? `${producto.carga_lb} lb${producto.carga_n ? ` · ${producto.carga_n} N` : ''}` : null} />
              <Spec label="Factor de seguridad" value={producto?.factor_seguridad} />
            </div>
          </Section>

          {ficha ? (
            <Section label="Especificaciones técnicas">
              {ficha.descripcion ? (
                <p style={{ fontSize: 13, color: C.gray, lineHeight: 1.6, margin: '0 0 18px' }}>{ficha.descripcion}</p>
              ) : null}

              {ficha.nomenclatura && ficha.nomenclatura.length > 0 ? (
                <div style={{ background: C.bg, borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.black, marginBottom: 10 }}>
                    Qué significa <span style={{ fontVariantNumeric: 'tabular-nums' }}>{lote.sku}</span>
                  </div>
                  {ficha.nomenclatura.map((n, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '5px 0' }}>
                      <span style={{ minWidth: 46, fontSize: 13, fontWeight: 700, color: C.greenDark, fontVariantNumeric: 'tabular-nums' }}>{n.sigla}</span>
                      <span style={{ fontSize: 13, color: C.gray }}>{n.significado}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {ficha.especificaciones && ficha.especificaciones.length > 0
                ? ficha.especificaciones.map((e, i) => <Spec key={i} label={e.label} value={e.value} />)
                : null}
            </Section>
          ) : (
            <Section label="Producto">
              <Spec label="Rango telescópico" value={rango} />
              <Spec label="Altura" value={producto?.altura_mm ? `${producto.altura_mm} mm` : null} />
            </Section>
          )}

          {/* Certificación — firma del ingeniero matriculado */}
          <Section label="Certificación de seguridad estructural">
            <Spec label="Fecha de certificación" value={fmtFecha(lote.fecha_certificacion)} />
            <Spec label="Vigencia" value={`${lote.vigencia_meses} meses`} />

            {ingeniero ? (
              <div style={{ marginTop: 22 }}>
                <div style={{ fontSize: 11, color: C.grayLt, marginBottom: 12 }}>
                  Documento original firmado y certificado por
                </div>
                <div style={{ paddingTop: 14, borderTop: `1.5px solid ${C.black}` }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.black, letterSpacing: '-0.01em' }}>{ingeniero.nombre}</div>
                  <div style={{ fontSize: 13, color: C.gray, marginTop: 3 }}>{ingeniero.titulo ?? 'Ingeniero Mecánico'}</div>
                  {ingeniero.matricula ? (
                    <div style={{ fontSize: 13, color: C.black, fontWeight: 600, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                      Matrícula Profesional {ingeniero.matricula}
                    </div>
                  ) : null}
                  {ingeniero.email ? (
                    <div style={{ fontSize: 12, color: C.grayLt, marginTop: 4 }}>{ingeniero.email}</div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </Section>

          {fabricante ? (
            <Section label="Fabricante">
              <Spec label="Razón social" value={fabricante.nombre} />
              <Spec label="NIT" value={fabricante.nit} />
              <Spec label="Teléfono" value={fabricante.telefono} />
              <Spec label="Correo" value={fabricante.email} />
            </Section>
          ) : null}
        </div>

        {/* Footer — Powered by MéTRIK (única presencia de MéTRIK) */}
        <div style={{ borderTop: `1px solid ${C.hair}`, background: C.bg, padding: '18px 24px', textAlign: 'center' }}>
          <a href="https://metrik.com.co" target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, textDecoration: 'none' }}>
            <span style={{ fontSize: 12, color: C.gray }}>Powered by</span>
            <span style={{ position: 'relative', display: 'inline-flex', paddingBottom: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: C.black, lineHeight: 1 }}>MéTRIK</span>
              <span style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: 1.5, background: C.green, borderRadius: 1 }} />
            </span>
          </a>
          <div style={{ fontSize: 10.5, color: C.grayLt, marginTop: 8 }}>Verificación de autenticidad · metrik.com.co</div>
        </div>
      </div>
    </main>
  )
}
