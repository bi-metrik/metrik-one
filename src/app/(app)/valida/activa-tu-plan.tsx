import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { RUTA_ACTIVAR_PLAN, textoCorte, textoSaldo, type MotivoCorte, type SaldoBolsa } from '@/lib/valida/corte-bolsa'

/**
 * En lugar de los formularios de consulta cuando la bolsa se cortó (agotada o vencida). El
 * historial sigue abierto en su pestaña.
 */
export function ActivaTuPlan({ motivo, esPrueba }: { motivo: MotivoCorte; esPrueba: boolean }) {
  const { titulo, detalle } = textoCorte(motivo, esPrueba)
  return (
    <section data-activa-tu-plan={motivo} className="rounded-lg border border-border bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 hidden h-5 w-5 shrink-0 text-acento sm:block" />
        <div className="w-full space-y-3">
          <div>
            <h2 className="text-base font-semibold text-tinta">{titulo}</h2>
            <p className="mt-1 text-sm text-tinta-suave">{detalle}</p>
          </div>
          <Link
            href={RUTA_ACTIVAR_PLAN}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-acento px-5 text-sm font-semibold text-white sm:w-auto"
          >
            Activar plan
          </Link>
        </div>
      </div>
    </section>
  )
}

/** La línea del contador mientras la bolsa sigue vigente. */
export function SaldoConsultas({ saldo }: { saldo: SaldoBolsa }) {
  return (
    <Link
      href={RUTA_ACTIVAR_PLAN}
      data-saldo-consultas={saldo.saldo}
      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-white px-4 py-2.5 text-sm text-tinta"
    >
      <span>{textoSaldo(saldo)}</span>
      <span className="shrink-0 font-semibold text-acento">Activar plan</span>
    </Link>
  )
}
