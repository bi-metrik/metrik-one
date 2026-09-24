import { formatoPesosConSigno, nombreMes, PARTE_METRIK, sentidoLiquidacion, type MesLiquidacion } from '@/lib/ferreteria/liquidacion'

/**
 * Liquidación mensual de la alianza: por mes de la venta, la ganancia de TODAS las ventas del
 * mes (pérdidas incluidas) se reparte 50/50. Cada mes se liquida solo: nada pasa al siguiente.
 */
export function LiquidacionTabla({ meses }: { meses: MesLiquidacion[] }) {
  const pctMetrik = `${Math.round(PARTE_METRIK * 100)} %`
  const pctDimpro = `${Math.round((1 - PARTE_METRIK) * 100)} %`
  return (
    <section className="space-y-2">
      <p className="text-xs text-muted-foreground">
        La ganancia de todas las ventas del mes, pérdidas incluidas, se reparte {pctDimpro} Dimpro y {pctMetrik} MeTRIK. Si el mes da
        pérdida, MeTRIK le aporta a Dimpro su parte. Cada mes se liquida solo. El mes es el de la fecha de la venta; el mes en curso
        sigue abierto.
      </p>
      {meses.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay ventas.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Mes</th>
                <th className="px-3 py-2 text-right">Ventas</th>
                <th className="px-3 py-2 text-right">Ingreso</th>
                <th className="px-3 py-2 text-right">Costo</th>
                <th className="px-3 py-2 text-right">Ganancia</th>
                <th className="px-3 py-2 text-right">Dimpro ({pctDimpro})</th>
                <th className="px-3 py-2 text-right">MeTRIK ({pctMetrik})</th>
                <th className="px-3 py-2">Liquidación</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => {
                const s = sentidoLiquidacion(m.parteMetrik)
                return (
                  <tr key={m.mes} className="border-t">
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {nombreMes(m.mes)}
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                          m.estado === 'abierto' ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {m.estado}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m.ventas}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{formatoPesosConSigno(m.ingreso)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{formatoPesosConSigno(m.costo)}</td>
                    <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${m.ganancia < 0 ? 'text-red-600' : ''}`}>
                      {formatoPesosConSigno(m.ganancia)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{formatoPesosConSigno(m.parteDimpro)}</td>
                    <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${m.parteMetrik < 0 ? 'text-red-600' : ''}`}>
                      {formatoPesosConSigno(m.parteMetrik)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {s.valor === 0 ? s.texto : `${s.texto} ${formatoPesosConSigno(s.valor)}`}
                      {m.estado === 'abierto' && <span className="text-xs text-muted-foreground"> (parcial)</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Ingreso es el precio final de cada venta y costo, el costo F del día de la venta. La ganancia sale de la fórmula de
        ganancia por venta (precio × 0,777933 − costo × 0,840336), por eso no es ingreso menos costo.
      </p>
    </section>
  )
}
