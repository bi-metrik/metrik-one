'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle,
  ArrowRight, Copy, RefreshCw, DollarSign, Clock, Shield,
} from 'lucide-react'
import { toast } from 'sonner'
import { generarMensajeCobro, getTipoCobro } from './collection-messages'

type Estado = 'verde' | 'amarillo' | 'rojo'

interface SemaforoData {
  semaforo: {
    estado: Estado
    emoji: string
    mensajePrincipal: string
    mensajeSecundario: string
  }
  resumen: {
    tienes: number
    teDeben: number
    teDebenSeguro: number
    debes: number
    gastoMensual: number
  }
  indicadores: {
    p2: { estado: Estado; ratio: number }
    p3: { estado: Estado; ratio: number }
    p4: { estado: Estado; diasHastaFechaCritica: number | null }
  }
  confianza: {
    nivel: 'alta' | 'media' | 'baja'
    diasSinActualizar: number
  }
  accion: { tipo: string; titulo: string; subtitulo: string } | null
  clientesRiesgo: Array<{ concepto: string; monto: number; diasVencida: number }>
  tieneCuentas: boolean
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

const fmtShort = (v: number) => {
  if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`
  return `$${v.toLocaleString('es-CO')}`
}

const ESTADO_COLORS: Record<Estado, { bg: string; text: string; border: string }> = {
  verde: { bg: 'bg-green-50 dark:bg-green-950/20', text: 'text-green-700 dark:text-green-400', border: 'border-green-200 dark:border-green-900/30' },
  amarillo: { bg: 'bg-yellow-50 dark:bg-yellow-950/20', text: 'text-yellow-700 dark:text-yellow-400', border: 'border-yellow-200 dark:border-yellow-900/30' },
  rojo: { bg: 'bg-red-50 dark:bg-red-950/20', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-900/30' },
}

const CONFIANZA_COLORS: Record<string, string> = {
  alta: 'text-green-600',
  media: 'text-yellow-600',
  baja: 'text-red-600',
}

export default function SemaforoClient({ data }: { data: SemaforoData }) {
  const [showRiesgo, setShowRiesgo] = useState(false)
  const { semaforo, resumen, indicadores, confianza, accion, clientesRiesgo, tieneCuentas } = data
  const colors = ESTADO_COLORS[semaforo.estado]

  // Onboarding if no bank accounts
  if (!tieneCuentas) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Semáforo Financiero</h1>
        <div className="rounded-xl border border-dashed p-8 text-center space-y-4">
          <div className="text-5xl">🏦</div>
          <h2 className="text-lg font-semibold">Configura tus cuentas bancarias</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Para que el semáforo funcione, necesitas registrar al menos una cuenta bancaria y su saldo actual.
          </p>
          <Link
            href="/config"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Ir a configuración <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    )
  }

  const handleCopyMessage = (cliente: { concepto: string; monto: number; diasVencida: number }) => {
    const tipo = getTipoCobro(cliente.diasVencida)
    const msg = generarMensajeCobro(tipo, { nombre: cliente.concepto, monto: cliente.monto, diasVencida: cliente.diasVencida })
    navigator.clipboard.writeText(msg)
    toast.success('Mensaje de cobro copiado')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Semáforo Financiero</h1>
        <div className={`flex items-center gap-1.5 text-xs font-medium ${CONFIANZA_COLORS[confianza.nivel]}`}>
          <Shield className="h-3.5 w-3.5" />
          {confianza.nivel === 'alta' ? 'Datos al día' :
           confianza.nivel === 'media' ? 'Actualiza saldos' :
           `${confianza.diasSinActualizar}d sin actualizar`}
        </div>
      </div>

      {/* Main traffic light */}
      <div className={`rounded-2xl border-2 ${colors.border} ${colors.bg} p-8 text-center space-y-3`}>
        <div className="text-6xl">{semaforo.emoji}</div>
        <h2 className={`text-xl font-bold ${colors.text}`}>{semaforo.mensajePrincipal}</h2>
        {semaforo.mensajeSecundario && (
          <p className="text-sm text-muted-foreground">{semaforo.mensajeSecundario}</p>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5" /> Tienes
          </div>
          <p className="mt-1 text-xl font-bold">{fmtShort(resumen.tienes)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" /> Te deben
          </div>
          <p className="mt-1 text-xl font-bold text-green-600">{fmtShort(resumen.teDeben)}</p>
          <p className="text-[10px] text-muted-foreground">Seguro: {fmtShort(resumen.teDebenSeguro)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingDown className="h-3.5 w-3.5" /> Debes/mes
          </div>
          <p className="mt-1 text-xl font-bold text-red-500">{fmtShort(resumen.debes)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Gasto promedio
          </div>
          <p className="mt-1 text-xl font-bold">{fmtShort(resumen.gastoMensual)}</p>
          <p className="text-[10px] text-muted-foreground">/mes (últ. 90d)</p>
        </div>
      </div>

      {/* Indicators P2-P4 */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { key: 'P2', label: 'Cartera', desc: `Ratio: ${indicadores.p2.ratio.toFixed(1)}x`, estado: indicadores.p2.estado },
          { key: 'P3', label: 'Obligaciones', desc: `Ratio: ${indicadores.p3.ratio.toFixed(1)}x`, estado: indicadores.p3.estado },
          {
            key: 'P4', label: 'Flujo de caja',
            desc: indicadores.p4.diasHastaFechaCritica !== null
              ? `${indicadores.p4.diasHastaFechaCritica}d hasta fecha crítica`
              : 'Sin riesgo en 90d',
            estado: indicadores.p4.estado,
          },
        ].map(ind => {
          const ic = ESTADO_COLORS[ind.estado]
          return (
            <div key={ind.key} className={`rounded-xl border ${ic.border} ${ic.bg} p-4`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-muted-foreground">{ind.key}</span>
                <span className="text-lg">
                  {ind.estado === 'verde' ? '🟢' : ind.estado === 'amarillo' ? '🟡' : '🔴'}
                </span>
              </div>
              <p className={`mt-1 text-sm font-semibold ${ic.text}`}>{ind.label}</p>
              <p className="text-[10px] text-muted-foreground">{ind.desc}</p>
            </div>
          )
        })}
      </div>

      {/* Suggested action */}
      {accion && (
        <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold">{accion.titulo}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{accion.subtitulo}</p>
            </div>
            {accion.tipo === 'actualizar' && (
              <Link
                href="/config"
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Actualizar
              </Link>
            )}
            {accion.tipo === 'cobrar' && clientesRiesgo[0] && (
              <button
                onClick={() => handleCopyMessage(clientesRiesgo[0])}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Copy className="h-3.5 w-3.5" /> Copiar mensaje
              </button>
            )}
          </div>
        </div>
      )}

      {/* Risk clients */}
      {clientesRiesgo.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setShowRiesgo(!showRiesgo)}
            className="flex items-center gap-2 text-sm font-semibold hover:underline"
          >
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {clientesRiesgo.length} cobro{clientesRiesgo.length !== 1 ? 's' : ''} en riesgo
          </button>

          {showRiesgo && (
            <div className="space-y-2">
              {clientesRiesgo.map((c, i) => {
                const tipo = getTipoCobro(c.diasVencida)
                return (
                  <div key={i} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">{c.concepto}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmt(c.monto)} · {c.diasVencida} días vencida
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        tipo === 'urgente' ? 'bg-red-100 text-red-700 dark:bg-red-900/30' :
                        tipo === 'firme' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30' :
                        'bg-gray-100 text-gray-700 dark:bg-gray-800'
                      }`}>
                        {tipo}
                      </span>
                      <button
                        onClick={() => handleCopyMessage(c)}
                        className="rounded p-1 hover:bg-accent"
                        title="Copiar mensaje de cobro"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
