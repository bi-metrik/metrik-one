'use client'

import { useState, useTransition } from 'react'
import { getDatabookUrl } from '@/lib/cert/public-actions'

const C = { black: '#1A1A1A', gray: '#6B7280', grayLt: '#9CA3AF', green: '#10B981', greenDark: '#059669', red: '#B91C1C', line: '#E5E7EB', white: '#FFFFFF' }

export default function DatabookDownload({ loteId }: { loteId: string }) {
  const [open, setOpen] = useState(false)
  const [pwd, setPwd] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function descargar() {
    setErr(null)
    start(async () => {
      const r = await getDatabookUrl(loteId, pwd)
      if (r.error) { setErr(r.error); return }
      if (r.url) { window.open(r.url, '_blank', 'noopener'); setOpen(false); setPwd('') }
    })
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 10,
          background: C.white, border: `1px solid ${C.line}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.black }}>Descargar DataBook técnico</span>
        <span style={{ fontSize: 11, color: C.grayLt }}>🔒 requiere contrato</span>
      </button>
    )
  }

  return (
    <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 12, color: C.gray, marginBottom: 8 }}>
        Ingresa el <strong style={{ color: C.black }}>número de contrato</strong> para descargar el DataBook.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') descargar() }}
          placeholder="N° de contrato"
          autoFocus
          style={{ flex: 1, padding: '9px 12px', border: `1px solid ${C.line}`, borderRadius: 9, fontSize: 14, color: C.black }}
        />
        <button onClick={descargar} disabled={pending || !pwd.trim()}
          style={{ background: C.greenDark, color: C.white, border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: pending || !pwd.trim() ? 0.6 : 1 }}>
          {pending ? '…' : 'Descargar'}
        </button>
      </div>
      {err && <div style={{ fontSize: 12, color: C.red, marginTop: 8 }}>{err}</div>}
      <button onClick={() => { setOpen(false); setErr(null); setPwd('') }}
        style={{ marginTop: 10, fontSize: 11, color: C.gray, background: 'none', border: 'none', cursor: 'pointer' }}>Cancelar</button>
    </div>
  )
}
