'use client'

/**
 * Corregir el TITULAR de la factura (nombre y documento) en la revisión, antes de
 * facturar. Decisión de Mauricio (2026-09-22).
 *
 * La factura, el recibo de la tarifa UPME y los abonos salen a nombre del titular del
 * negocio, que hoy sale del RUT. Si el RUT lo trae mal, la única salida era volver a
 * subirlo, y ese reproceso re-extrae todo el bloque y borra datos. Aquí se corrige sin
 * tocar el RUT: la corrección queda aparte, con quién y cuándo.
 *
 * El componente solo pinta. Lo que decide (qué es válido, qué avisar) vive en
 * `@/lib/facturacion/titular-revision`, con la misma regla que aplica el servidor.
 */

import { AlertTriangle } from 'lucide-react'
import { TIPOS_DOCUMENTO_TITULAR, documentoLegible, esDocumentoDeEmpresa } from '@/lib/siigo/titular'
import { formatBogotaFechaCortaAno } from '@/lib/dates/bogota'
import {
  avisosDeTitular,
  errorDelTitular,
  titularCambio,
  type TitularEnPantalla,
} from '@/lib/facturacion/titular-revision'
import type { CasoPorFacturar } from '@/lib/actions/facturacion-actions'

/**
 * Las filas de «Así saldría la factura» que dicen a nombre de QUIÉN sale.
 *
 * El TITULAR es a nombre de quién salen la factura, el recibo y los abonos: el del RUT,
 * o el que corrigió la financiera. El CONTACTO va al lado para que se vea que NO es a
 * él: suele ser quien pagó o quien vendió (V0502: contacto Paula Andrea Oliveros,
 * titular John Jairo Cifuentes Sabogal), y la factura no sale a su nombre.
 *
 * Va dentro de un `<dl>`: por eso las filas son `div` con `dt`/`dd`, y la nota también
 * es un `div` (un `<p>` no puede ser hijo de un `<dl>`).
 */
export function ResumenTitular({
  caso,
}: {
  caso: Pick<CasoPorFacturar, 'cliente' | 'identificacion' | 'contacto_nombre' | 'titular'>
}) {
  const filas: Array<[string, string]> = [
    ['Titular', caso.cliente ?? '—'],
    ['Documento', caso.titular.numero
      ? documentoLegible({ tipo_documento: caso.titular.tipo_documento, numero: caso.titular.numero, dv: caso.titular.dv })
      : (caso.identificacion ?? '—')],
  ]
  if (caso.contacto_nombre) filas.push(['Contacto del negocio (no es el titular)', caso.contacto_nombre])
  const c = caso.titular.corregido
  const fecha = c?.at ? formatBogotaFechaCortaAno(c.at) : null
  const delRut = c ? [c.rut.nombre, c.rut.identificacion].filter(Boolean).join(' · ') || 'sin datos' : ''

  return (
    <>
      {filas.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <dt style={{ color: 'var(--tinta-suave)' }}>{k}</dt>
          <dd className="text-right" style={{ color: 'var(--tinta)' }}>{v}</dd>
        </div>
      ))}
      {c && (
        <div className="text-[10.5px]" style={{ color: 'var(--tinta-suave)' }}>
          {`Titular corregido${c.por ? ` por ${c.por}` : ''}${fecha ? ` el ${fecha}` : ''}. El RUT dice: ${delRut}.`}
        </div>
      )}
    </>
  )
}

const campo = 'mt-0.5 w-full rounded-md border bg-white px-2 py-1 text-[12px] focus:outline-none disabled:opacity-50'
const estiloCampo = { borderColor: 'var(--acento-borde)', color: 'var(--tinta)' }

export function EditorTitular({
  caso, valor, onCambio, disabled,
}: {
  caso: Pick<CasoPorFacturar, 'titular' | 'tercero_siigo' | 'recibos_emitidos'>
  valor: TitularEnPantalla
  onCambio: (v: TitularEnPantalla) => void
  disabled?: boolean
}) {
  const empresa = esDocumentoDeEmpresa(valor.tipo_documento)
  const set = (k: keyof TitularEnPantalla) => (v: string) => onCambio({ ...valor, [k]: v })
  // El error solo se dice cuando hay algo escrito distinto: abrir el editor sobre un
  // titular del RUT incompleto no es un error de quien lo abrió.
  const error = titularCambio(caso, valor) ? errorDelTitular(valor) : null
  const avisos = avisosDeTitular(caso, valor)

  return (
    <div className="space-y-1.5 rounded-md border bg-white/60 p-2" style={{ borderColor: 'var(--acento-borde)' }}>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        <label className="block">
          <span className="text-[11px]" style={{ color: 'var(--tinta-suave)' }}>Tipo de documento</span>
          <select
            value={valor.tipo_documento}
            onChange={e => set('tipo_documento')(e.target.value)}
            disabled={disabled}
            className={campo}
            style={estiloCampo}
          >
            {TIPOS_DOCUMENTO_TITULAR.map(t => (
              <option key={t.code} value={t.code}>{t.etiqueta}</option>
            ))}
          </select>
        </label>
        <label className={empresa ? 'block' : 'block sm:col-span-2'}>
          <span className="text-[11px]" style={{ color: 'var(--tinta-suave)' }}>Número</span>
          <input
            inputMode="numeric"
            value={valor.numero}
            onChange={e => set('numero')(e.target.value)}
            disabled={disabled}
            placeholder="Sin puntos"
            className={campo}
            style={estiloCampo}
          />
        </label>
        {/* El DV solo existe para el NIT. Vacío = lo calcula ONE; escrito = se revisa
            contra el NIT, porque uno que no cuadra es facturarle a otra empresa. */}
        {empresa && (
          <label className="block">
            <span className="text-[11px]" style={{ color: 'var(--tinta-suave)' }}>DV</span>
            <input
              inputMode="numeric"
              maxLength={1}
              value={valor.dv}
              onChange={e => set('dv')(e.target.value)}
              disabled={disabled}
              placeholder="Se calcula"
              className={campo}
              style={estiloCampo}
            />
          </label>
        )}
      </div>

      {empresa ? (
        <label className="block">
          <span className="text-[11px]" style={{ color: 'var(--tinta-suave)' }}>Razón social</span>
          <input
            value={valor.razon_social}
            onChange={e => set('razon_social')(e.target.value)}
            disabled={disabled}
            className={campo}
            style={estiloCampo}
          />
        </label>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px]" style={{ color: 'var(--tinta-suave)' }}>Nombres</span>
            <input
              value={valor.nombres}
              onChange={e => set('nombres')(e.target.value)}
              disabled={disabled}
              className={campo}
              style={estiloCampo}
            />
          </label>
          <label className="block">
            <span className="text-[11px]" style={{ color: 'var(--tinta-suave)' }}>Apellidos</span>
            <input
              value={valor.apellidos}
              onChange={e => set('apellidos')(e.target.value)}
              disabled={disabled}
              className={campo}
              style={estiloCampo}
            />
          </label>
        </div>
      )}

      {error && (
        <p className="text-[11px] font-medium" style={{ color: '#B91C1C' }}>{error}</p>
      )}

      {avisos.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-md border p-2"
             style={{ borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: '#B45309' }} />
          <ul className="space-y-1 text-[11.5px]" style={{ color: '#92400E' }}>
            {avisos.map(a => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}

      <p className="text-[10.5px]" style={{ color: 'var(--tinta-suave)' }}>
        El RUT cargado no se modifica: la corrección queda aparte, con tu nombre y la fecha.
        La dirección, la ciudad, el correo y el teléfono siguen saliendo de donde salían.
      </p>
    </div>
  )
}
