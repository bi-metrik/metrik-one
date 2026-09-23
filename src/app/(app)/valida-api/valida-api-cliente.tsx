'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  BarChart3,
  Check,
  Copy,
  CreditCard,
  FileText,
  HelpCircle,
  KeyRound,
  Receipt,
} from 'lucide-react'
import { EntradaTerminos, TextoDocumento } from '@/components/terminos/entrada-terminos'
import { AvisoCarga, PestanaTerminos } from '@/components/terminos/pestana-terminos'
import { generarLlaveValidaApi, revocarLlaveValidaApi } from '@/lib/valida-api/acciones'
import { vistaConsumo } from '@/lib/valida-api/consumo-vista'
import type {
  FacturaDeCobro,
  LlaveRecienEmitida,
  ResultadoLlaves,
  ResultadoPagos,
  ResultadoResumen,
  ResultadoTerminosAprobados,
} from '@/lib/valida-api/resultados'
import type { LlaveValida } from '@/lib/valida-api/tipos'
import { formatBogotaFechaCortaAno, formatBogotaFechaHora } from '@/lib/dates/bogota'
import { formatCOP } from '@/lib/cobros/format'

// ── La entrada ─────────────────────────────────────────────────────────────
//
// Vive en `@/components/terminos/entrada-terminos` desde el 2026-09-23: la comparte Valida de los
// CDA. Estos nombres se conservan para quien ya los importa desde aquí.
export { EntradaTerminos as EntradaValidaApi, TextoDocumento }
// La pestaña Términos y el aviso de carga viven en `@/components/terminos/pestana-terminos` desde el
// 2026-09-23: los comparte la pestaña Términos de Valida de los CDA.
export { PestanaTerminos }

// ── Pestañas ───────────────────────────────────────────────────────────────

type Pestana = 'llaves' | 'consumo' | 'suscripcion' | 'terminos' | 'pagos' | 'ayuda'

export function ValidaApiCliente({
  resumen,
  llaves,
  terminos,
  pagos,
  operaLlaves,
  vePagos,
}: {
  resumen: ResultadoResumen
  llaves: ResultadoLlaves | null
  terminos: ResultadoTerminosAprobados
  pagos: ResultadoPagos | null
  operaLlaves: boolean
  vePagos: boolean
}) {
  const [pestana, setPestana] = useState<Pestana>(operaLlaves ? 'llaves' : 'consumo')

  const pestanas: { id: Pestana; etiqueta: string; icono: React.ReactNode; visible: boolean }[] = [
    { id: 'llaves', etiqueta: 'Llaves', icono: <KeyRound className="h-4 w-4" />, visible: operaLlaves },
    { id: 'consumo', etiqueta: 'Consumo', icono: <BarChart3 className="h-4 w-4" />, visible: true },
    { id: 'suscripcion', etiqueta: 'Suscripción', icono: <CreditCard className="h-4 w-4" />, visible: true },
    { id: 'terminos', etiqueta: 'Términos', icono: <FileText className="h-4 w-4" />, visible: true },
    { id: 'pagos', etiqueta: 'Pagos', icono: <Receipt className="h-4 w-4" />, visible: vePagos },
    { id: 'ayuda', etiqueta: 'Ayuda', icono: <HelpCircle className="h-4 w-4" />, visible: true },
  ]

  return (
    <div className="space-y-5">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
        {pestanas
          .filter((p) => p.visible)
          .map((p) => (
            <button
              key={p.id}
              role="tab"
              type="button"
              aria-selected={pestana === p.id}
              onClick={() => setPestana(p.id)}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                pestana === p.id ? 'border-tinta text-tinta' : 'border-transparent text-tinta-suave hover:text-tinta'
              }`}
            >
              {p.icono}
              {p.etiqueta}
            </button>
          ))}
      </div>

      {pestana === 'llaves' && llaves && <PestanaLlaves carga={llaves} />}
      {pestana === 'consumo' && <PestanaConsumo carga={resumen} />}
      {pestana === 'suscripcion' && <PestanaSuscripcion />}
      {pestana === 'terminos' && <PestanaTerminos carga={terminos} />}
      {pestana === 'pagos' && pagos && <PestanaPagos carga={pagos} />}
      {pestana === 'ayuda' && <PestanaAyuda />}
    </div>
  )
}

// ── Llaves ──────────────────────────────────────────────────────────────────

const ETIQUETA_ESTADO_LLAVE: Record<LlaveValida['estado'], string> = {
  activa: 'Activa',
  en_retiro: 'En retiro',
  vencida: 'Vencida',
  revocada: 'Revocada',
}

function PestanaLlaves({ carga }: { carga: ResultadoLlaves }) {
  const router = useRouter()
  const [nombre, setNombre] = useState('')
  const [recien, setRecien] = useState<LlaveRecienEmitida | null>(null)
  const [pendiente, iniciar] = useTransition()

  if (carga.estado !== 'ok') return <AvisoCarga carga={carga} />
  const { llaves, limite_vigentes } = carga.datos
  const vigentes = llaves.filter((l) => l.estado === 'activa' || l.estado === 'en_retiro').length
  const enLimite = vigentes >= limite_vigentes

  function generar(args: { nombre?: string; reemplazaA?: string; revocarAnterior?: boolean }) {
    iniciar(async () => {
      const r = await generarLlaveValidaApi(args)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setRecien(r.llave)
      setNombre('')
      router.refresh()
    })
  }

  function revocar(llave: LlaveValida) {
    if (!window.confirm(`¿Revocar la llave «${llave.nombre ?? llave.key_prefix}»? Deja de funcionar en la siguiente consulta.`)) return
    iniciar(async () => {
      const r = await revocarLlaveValidaApi(llave.key_id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.yaEstabaRevocada ? 'La llave ya estaba revocada.' : 'Llave revocada.')
      router.refresh()
    })
  }

  function regenerar(llave: LlaveValida) {
    if (!window.confirm(`¿Regenerar «${llave.nombre ?? llave.key_prefix}»? Recibirás una llave nueva; la anterior sigue funcionando un tiempo para que la cambies en tu sistema.`)) return
    generar({ reemplazaA: llave.key_id, revocarAnterior: false })
  }

  return (
    <div className="space-y-5">
      {recien && <LlaveUnaVez llave={recien} onCerrar={() => setRecien(null)} />}

      <div className="rounded-lg border border-border bg-white p-4">
        <p className="text-sm font-semibold text-tinta">Generar una llave</p>
        <p className="mt-1 text-xs text-tinta-suave">
          Tienes {vigentes} de {limite_vigentes} llaves vigentes.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={60}
            placeholder="Nombre, por ejemplo «ERP de facturación»"
            className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={pendiente || enLimite || nombre.trim().length === 0}
            onClick={() => generar({ nombre })}
            className="rounded-md bg-acento px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Generar
          </button>
        </div>
        {enLimite && (
          <p className="mt-2 text-xs text-amber-800">Llegaste al máximo de llaves vigentes. Revoca una para generar otra.</p>
        )}
      </div>

      {llaves.length === 0 ? (
        <p className="text-sm text-tinta-suave">Todavía no hay llaves para tu integración.</p>
      ) : (
        <ul className="space-y-2">
          {llaves.map((l) => (
            <li key={l.key_id} className="rounded-lg border border-border bg-white p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-tinta">{l.nombre ?? 'Sin nombre'}</span>
                <span className="text-xs text-tinta-suave">{ETIQUETA_ESTADO_LLAVE[l.estado] ?? l.estado}</span>
              </div>
              <p className="mt-1 font-mono text-xs text-tinta-suave">{l.key_prefix}…</p>
              <p className="mt-1 text-xs text-tinta-suave">
                Creada {formatBogotaFechaCortaAno(l.creada_en) ?? '—'}
                {' · '}
                {l.ultima_uso_en ? `último uso ${formatBogotaFechaHora(l.ultima_uso_en)}` : 'sin uso todavía'}
                {l.estado === 'en_retiro' && l.vence_en && ` · deja de funcionar ${formatBogotaFechaHora(l.vence_en)}`}
              </p>
              {l.estado === 'activa' && (
                <div className="mt-2 flex gap-3">
                  <button type="button" disabled={pendiente} onClick={() => regenerar(l)} className="text-xs font-semibold text-acento disabled:opacity-50">
                    Regenerar
                  </button>
                  <button type="button" disabled={pendiente} onClick={() => revocar(l)} className="text-xs font-semibold text-red-700 disabled:opacity-50">
                    Revocar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * La llave EN CLARO, una sola vez. Vive solo en el estado de este componente: no va a
 * localStorage, ni a la URL, ni a un log. Al cerrar el panel se descarta.
 */
export function LlaveUnaVez({ llave, onCerrar }: { llave: LlaveRecienEmitida; onCerrar: () => void }) {
  const [copiada, setCopiada] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(llave.llave)
      setCopiada(true)
    } catch {
      toast.error('No se pudo copiar. Selecciona el texto y cópialo a mano.')
    }
  }

  return (
    <div className="rounded-lg border-2 border-acento bg-acento-tinte p-4">
      <p className="text-sm font-semibold text-tinta">
        {llave.regenerada ? 'Llave regenerada' : 'Llave generada'}: {llave.nombre}
      </p>
      <p className="mt-1 text-sm font-semibold text-red-700">
        Esta es la única vez que vas a ver esta llave. Guárdala ahora en un lugar seguro: Valida solo conserva su huella y no podrá mostrártela de nuevo.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-white px-3 py-2 font-mono text-xs text-tinta">
          {llave.llave}
        </code>
        <button type="button" onClick={copiar} className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-tinta">
          {copiada ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copiada ? 'Copiada' : 'Copiar'}
        </button>
      </div>
      {llave.anteriorDejaDeAutenticarEn && (
        <p className="mt-2 text-xs text-tinta-suave">
          La llave anterior deja de funcionar el {formatBogotaFechaHora(llave.anteriorDejaDeAutenticarEn)}.
        </p>
      )}
      <button type="button" onClick={onCerrar} className="mt-3 text-sm font-semibold text-acento">
        Ya la guardé
      </button>
    </div>
  )
}

// ── Consumo ─────────────────────────────────────────────────────────────────

function PestanaConsumo({ carga }: { carga: ResultadoResumen }) {
  if (carga.estado !== 'ok') return <AvisoCarga carga={carga} />
  const vista = vistaConsumo(carga.datos)

  if (vista.tipo === 'sin_datos') {
    return <p className="text-sm text-tinta-suave">Valida no devolvió datos de consumo para tu cuenta.</p>
  }
  if (vista.tipo === 'mensual') {
    return <p className="text-sm text-tinta-suave">Tu cuenta tiene un plan mensual, no un paquete de consultas.</p>
  }

  return (
    <div className="space-y-4">
      {vista.vigente ? (
        <div className="rounded-lg border border-border bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-tinta">Paquete vigente</p>
            <p className="text-xs text-tinta-suave">Vence el {formatBogotaFechaCortaAno(vista.vigente.venceEn) ?? '—'}</p>
          </div>
          <p className="mt-2 text-2xl font-bold text-tinta">
            {vista.vigente.saldo.toLocaleString('es-CO')}{' '}
            <span className="text-sm font-normal text-tinta-suave">consultas disponibles</span>
          </p>
          <p className="text-xs text-tinta-suave">
            {vista.vigente.consumidas.toLocaleString('es-CO')} usadas de {vista.vigente.compradas.toLocaleString('es-CO')}
            {vista.vigente.porcentajeUsado !== null && ` (${vista.vigente.porcentajeUsado} %)`}
          </p>
          {vista.vigente.porcentajeUsado !== null && (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-papel">
              <div className="h-full bg-acento" style={{ width: `${vista.vigente.porcentajeUsado}%` }} />
            </div>
          )}
          {vista.vigente.cortada && (
            <p className="mt-3 text-sm font-semibold text-red-700">
              Este paquete está {vista.vigente.estado === 'vencida' ? 'vencido' : 'agotado'}: la API responde 402 hasta que haya uno nuevo.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-tinta-suave">No tienes un paquete vigente en este momento.</p>
      )}

      {vista.enEspera && (
        <div className="rounded-lg border border-border bg-white p-4 text-sm">
          <p className="font-semibold text-tinta">Paquete en espera</p>
          <p className="mt-1 text-tinta-suave">
            {vista.enEspera.consultas_compradas.toLocaleString('es-CO')} consultas pagadas. Se activa solo cuando el vigente se agote o venza.
          </p>
        </div>
      )}

      {vista.historial.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-tinta">Paquetes anteriores</p>
          <ul className="space-y-1 text-xs text-tinta-suave">
            {vista.historial.map((h) => (
              <li key={h.bolsa_id}>
                #{h.secuencia} · {h.consultas_compradas.toLocaleString('es-CO')} consultas · {h.consumidas.toLocaleString('es-CO')} usadas · {h.estado}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Suscripción: C4. Honesto, sin datos inventados ──────────────────────────

function PestanaSuscripcion() {
  return (
    <div className="rounded-lg border border-border bg-papel p-4 text-sm text-tinta-suave">
      <p className="font-semibold text-tinta">Todavía no tienes una suscripción</p>
      <p className="mt-1">
        Tus paquetes de consultas se recargan hoy por solicitud a MeTRIK. La renovación automática con tarjeta llega más adelante y
        vas a poder activarla desde aquí, después de aceptar los términos que la regulan.
      </p>
    </div>
  )
}

// ── Pagos ───────────────────────────────────────────────────────────────────

const ETIQUETA_ESTADO_COBRO = { pagado: 'Pagado', programado: 'Programado', anulado: 'Anulado' } as const

function PestanaPagos({ carga }: { carga: ResultadoPagos }) {
  if (carga.estado !== 'ok') return <AvisoCarga carga={carga} />
  if (carga.datos.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-papel p-4 text-sm text-tinta-suave">
        Tus pagos aparecen aquí cuando MeTRIK registre el contrato de este espacio.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {carga.datos.map((s) => (
        <section key={s.servicioContratadoId} className="rounded-lg border border-border bg-white p-4">
          <p className="text-sm font-semibold text-tinta">{s.nombre}</p>
          {s.cobros.length === 0 ? (
            <p className="mt-2 text-xs text-tinta-suave">Sin pagos registrados en este contrato.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-tinta-suave">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Fecha</th>
                    <th className="py-1 pr-3 font-medium">Concepto</th>
                    <th className="py-1 pr-3 font-medium">Valor</th>
                    <th className="py-1 pr-3 font-medium">Medio</th>
                    <th className="py-1 pr-3 font-medium">Estado</th>
                    <th className="py-1 pr-3 font-medium">Recibo</th>
                    <th className="py-1 font-medium">Factura</th>
                  </tr>
                </thead>
                <tbody className="text-tinta">
                  {s.cobros.map((c) => (
                    <tr key={c.cobroId} className="border-t border-border">
                      <td className="py-1.5 pr-3">{c.fecha ? formatBogotaFechaCortaAno(c.fecha) : '—'}</td>
                      <td className="py-1.5 pr-3">{c.concepto}</td>
                      <td className={`py-1.5 pr-3 ${c.estado === 'anulado' ? 'line-through text-tinta-suave' : ''}`}>{formatCOP(c.monto)}</td>
                      <td className="py-1.5 pr-3">{c.fuente ?? '—'}</td>
                      <td className="py-1.5 pr-3">{ETIQUETA_ESTADO_COBRO[c.estado]}</td>
                      <td className="py-1.5 pr-3">
                        {c.reciboDescargable ? (
                          <a href={`/api/valida-api/archivo/recibo/${c.cobroId}`} className="font-semibold text-acento">
                            {c.reciboNumero ?? 'Descargar'}
                          </a>
                        ) : (
                          (c.reciboNumero ?? '—')
                        )}
                      </td>
                      <td className="py-1.5">
                        <CeldaFactura cobroId={c.cobroId} factura={c.factura} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

/**
 * La factura electrónica del cobro: el número descarga el PDF y, si MeTRIK cargó el XML, un enlace
 * aparte lo baja. Las dos descargas pasan por la ruta firmada del módulo; aquí no se pinta ninguna
 * ruta del bucket ni un enlace de Drive (§5.4).
 */
function CeldaFactura({ cobroId, factura }: { cobroId: string; factura: FacturaDeCobro | null }) {
  if (!factura) return <>—</>
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      {factura.pdfDescargable ? (
        <a
          href={`/api/valida-api/archivo/factura/${cobroId}`}
          className="font-semibold text-acento"
          title={factura.cufe ? `CUFE ${factura.cufe}` : undefined}
        >
          {factura.numero}
        </a>
      ) : (
        <span>{factura.numero}</span>
      )}
      {factura.xmlDescargable && (
        <a href={`/api/valida-api/archivo/factura_xml/${cobroId}`} className="text-acento">
          XML
        </a>
      )}
    </span>
  )
}

// ── Ayuda ───────────────────────────────────────────────────────────────────

const RECURSOS = [
  { titulo: 'Guía del integrador', url: 'https://valida.metrik.com.co/docs', texto: 'Cómo autenticarte, consultar y leer el resultado.' },
  { titulo: 'Referencia de la API', url: 'https://valida.metrik.com.co/docs/referencia', texto: 'Cada ruta, sus campos y sus errores.' },
  { titulo: 'Manual', url: 'https://valida.metrik.com.co/recursos/manual', texto: 'El servicio explicado paso a paso.' },
  { titulo: 'Seguridad', url: 'https://valida.metrik.com.co/recursos/seguridad', texto: 'Cómo proteger tus llaves y tus datos.' },
  { titulo: 'Soporte', url: 'https://valida.metrik.com.co/recursos/soporte', texto: 'Cómo pedir ayuda y en qué tiempos respondemos.' },
] as const

function PestanaAyuda() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {RECURSOS.map((r) => (
        <li key={r.url}>
          <a href={r.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-border bg-white p-4 hover:border-acento">
            <p className="text-sm font-semibold text-tinta">{r.titulo}</p>
            <p className="mt-1 text-xs text-tinta-suave">{r.texto}</p>
          </a>
        </li>
      ))}
    </ul>
  )
}
