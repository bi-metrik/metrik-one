'use client'

import { useState } from 'react'
import { BadgeCheck, ExternalLink, Loader2, Pencil, Plus, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'

import { fechaCorta } from '@/lib/proveedores/vigencia'
import { abrirCertificado, guardarCuenta, retirarCuenta, verificarCuenta, type CuentaVista } from '../actions'
import { subirArchivoProveedor } from './subir'

const campo = 'block h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground'
const etiqueta = 'min-w-0 space-y-0.5 text-[11px] text-muted-foreground'
const TIPO = { ahorros: 'Ahorros', corriente: 'Corriente', otra: 'Otra' } as const
const EVENTO: Record<string, string> = { creada: 'La cargó', cambiada: 'La cambió', verificada: 'La verificó', retirada: 'La retiró' }

interface Borrador {
  banco: string
  tipoCuenta: 'ahorros' | 'corriente' | 'otra'
  numero: string
  titular: string
  titularDocumento: string
}

const VACIO: Borrador = { banco: '', tipoCuenta: 'ahorros', numero: '', titular: '', titularDocumento: '' }

/**
 * «Cuenta bancaria» (solo área financiera). La regla dura del proceso (Hana): una cuenta nueva o
 * cambiada queda «pendiente» hasta que OTRA persona la verifica (llamando al proveedor por un
 * número que ya se tenía, no el del PDF). Cada paso queda en el historial.
 */
export default function SeccionCuentas({
  proveedorId,
  cuentas,
  yo,
  error,
  onCambio,
}: {
  proveedorId: string
  cuentas: CuentaVista[]
  yo: string | null
  error: string | null
  onCambio: () => void
}) {
  const [form, setForm] = useState<{ id: string | null; b: Borrador; certificado: File | null } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const correr = async (clave: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, exito: string) => {
    if (ocupado) return false
    setOcupado(clave)
    try {
      const r = await fn()
      if (!r.ok) {
        toast.error(r.error)
        return false
      }
      toast.success(exito)
      onCambio()
      return true
    } catch {
      toast.error('No se pudo. Vuelve a intentarlo.')
      return false
    } finally {
      setOcupado(null)
    }
  }

  const guardar = () =>
    form &&
    void correr(
      'guardar',
      async () => {
        let ruta: string | null = null
        if (form.certificado) {
          const s = await subirArchivoProveedor(proveedorId, 'cuentas', form.certificado)
          if (!s.ok) return s
          ruta = s.ruta
        }
        return guardarCuenta(proveedorId, form.id, form.b, ruta)
      },
      form.id ? 'Cuenta cambiada: queda pendiente de verificar' : 'Cuenta guardada: queda pendiente de verificar',
    ).then((ok) => ok && setForm(null))

  const abrir = async (id: string) => {
    const r = await abrirCertificado(id)
    if (!r.ok) return void toast.error(r.error)
    window.open(r.url, '_blank', 'noopener')
  }

  return (
    <section className="space-y-3" data-seccion="cuentas">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Cuenta bancaria</h2>
        {!form && (
          <button type="button" onClick={() => setForm({ id: null, b: VACIO, certificado: null })} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
            <Plus className="h-3.5 w-3.5" /> Agregar cuenta
          </button>
        )}
      </div>
      <p className="m-0 text-[11px] text-muted-foreground">
        Antes de pagar a una cuenta nueva o cambiada, otra persona del equipo la verifica llamando al proveedor a un número que ya teníamos (no al
        que viene en el PDF).
      </p>
      {error && <p className="m-0 text-xs text-[#B42318]">{error}</p>}

      {cuentas.length === 0 && !form && !error && <p className="m-0 text-xs text-muted-foreground">Sin cuentas registradas.</p>}

      <ul className="space-y-2">
        {cuentas.map((c) => {
          const mia = c.cargadaPorId === yo
          return (
            <li key={c.id} className="space-y-1.5 rounded-lg border p-2 text-xs" data-cuenta={c.id} data-estado={c.estado}>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm font-medium">
                    {c.banco} · {TIPO[c.tipoCuenta]} · <span className="tabular-nums">{c.numero}</span>
                  </p>
                  <p className="m-0 text-muted-foreground">
                    {c.titular}
                    {c.titularDocumento ? ` · ${c.titularDocumento}` : ''}
                  </p>
                </div>
                {c.estado === 'verificada' ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#10B981]/40 bg-[#10B981]/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#047857]">
                    <BadgeCheck className="h-3 w-3" /> Verificada
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#D97706]/40 bg-[#D97706]/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#9A5F0C]">
                    <ShieldAlert className="h-3 w-3" /> Pendiente: no pagar todavía
                  </span>
                )}
              </div>
              <p className="m-0 text-[11px] text-muted-foreground">
                Cargó {c.cargadaPor} el {fechaCorta(c.cargadaAt)}
                {c.verificadaPor && c.verificadaAt ? ` · verificó ${c.verificadaPor} el ${fechaCorta(c.verificadaAt)}` : ''}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {c.estado === 'pendiente' && (
                  <button
                    type="button"
                    disabled={mia || !!ocupado}
                    title={mia ? 'La tiene que verificar otra persona: tú la cargaste' : undefined}
                    onClick={() => void correr(`verificar:${c.id}`, () => verificarCuenta(c.id), 'Cuenta verificada')}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 disabled:opacity-50"
                  >
                    {ocupado === `verificar:${c.id}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Ya la verifiqué
                  </button>
                )}
                {c.estado === 'pendiente' && mia && <span className="self-center text-[11px] text-muted-foreground">La verifica otra persona: tú la cargaste.</span>}
                {c.tieneCertificado && (
                  <button type="button" onClick={() => void abrir(c.id)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
                    <ExternalLink className="h-3.5 w-3.5" /> Certificado
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setForm({ id: c.id, b: { banco: c.banco, tipoCuenta: c.tipoCuenta, numero: c.numero, titular: c.titular, titularDocumento: c.titularDocumento ?? '' }, certificado: null })}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1"
                >
                  <Pencil className="h-3.5 w-3.5" /> Cambiar
                </button>
                <button
                  type="button"
                  disabled={!!ocupado}
                  onClick={() => window.confirm('¿Retirar esta cuenta? Deja de usarse y queda en el historial.') && void correr(`retirar:${c.id}`, () => retirarCuenta(c.id), 'Cuenta retirada')}
                  className="rounded-md border px-2 py-1 text-[#B42318]"
                >
                  Retirar
                </button>
              </div>
              {c.historial.length > 0 && (
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer">Historial ({c.historial.length})</summary>
                  <ul className="mt-1 space-y-0.5">
                    {c.historial.map((h, i) => (
                      <li key={i}>
                        {fechaCorta(h.at)} · {EVENTO[h.evento] ?? h.evento} {h.por ?? 'alguien'}
                        {h.numeroAntes ? ` (antes: ${h.numeroAntes})` : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          )
        })}
      </ul>

      {form && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3" data-form-cuenta>
          {form.id && <p className="m-0 text-[11px] text-[#9A5F0C]">Cambiar la cuenta la deja pendiente: otra persona la tiene que verificar de nuevo.</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className={etiqueta}>
              Banco
              <input className={campo} value={form.b.banco} onChange={(e) => setForm({ ...form, b: { ...form.b, banco: e.target.value } })} />
            </label>
            <label className={etiqueta}>
              Tipo de cuenta
              <select className={campo} value={form.b.tipoCuenta} onChange={(e) => setForm({ ...form, b: { ...form.b, tipoCuenta: e.target.value as Borrador['tipoCuenta'] } })}>
                <option value="ahorros">Ahorros</option>
                <option value="corriente">Corriente</option>
                <option value="otra">Otra</option>
              </select>
            </label>
            <label className={etiqueta}>
              Número
              <input className={campo} value={form.b.numero} onChange={(e) => setForm({ ...form, b: { ...form.b, numero: e.target.value } })} inputMode="numeric" />
            </label>
            <label className={etiqueta}>
              Titular
              <input className={campo} value={form.b.titular} onChange={(e) => setForm({ ...form, b: { ...form.b, titular: e.target.value } })} />
            </label>
            <label className={etiqueta}>
              Documento del titular (NIT o cédula)
              <input className={campo} value={form.b.titularDocumento} onChange={(e) => setForm({ ...form, b: { ...form.b, titularDocumento: e.target.value } })} />
            </label>
            <label className={etiqueta}>
              Certificado bancario (opcional)
              <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="block w-full min-w-0 text-xs" onChange={(e) => setForm({ ...form, certificado: e.target.files?.[0] ?? null })} />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={guardar} disabled={!!ocupado} className="inline-flex h-9 items-center gap-1 rounded-md bg-[#10B981] px-4 text-sm font-medium text-white hover:bg-[#059669] disabled:opacity-50">
              {ocupado === 'guardar' && <Loader2 className="h-4 w-4 animate-spin" />} Guardar cuenta
            </button>
            <button type="button" className="h-9 px-2 text-xs text-muted-foreground" onClick={() => setForm(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
