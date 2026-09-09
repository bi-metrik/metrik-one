'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Check, Loader2, Play, Radar } from 'lucide-react';
import {
  activarMonitoreo,
  correrBarridoAhora,
  estadoMonitoreo,
  guardarConfigMonitoreo,
  type EstadoMonitoreo,
} from '@/lib/actions/compliance-monitoreo';
import {
  CUPO_MAX,
  CUPO_MIN,
  HORIZONTE_MAX,
  HORIZONTE_MIN,
} from '@/lib/compliance/monitoreo';

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export default function MonitoreoClient({ inicial }: { inicial: EstadoMonitoreo }) {
  const [estado, setEstado] = useState(inicial);
  const [cupo, setCupo] = useState(
    typeof inicial.cupo_periodo === 'number' ? String(inicial.cupo_periodo) : '',
  );
  const [horizonte, setHorizonte] = useState(String(inicial.horizonte_rechazadas_meses));
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function recargar() {
    const r = await estadoMonitoreo();
    if (r.ok) setEstado(r.data);
  }

  function activar() {
    startTransition(async () => {
      setError(null);
      setAviso(null);
      const r = await activarMonitoreo();
      if (!r.ok) return setError(r.error);
      await recargar();
      setAviso('Monitoreo activado. Corre en simulación hasta que fijes el tope.');
    });
  }

  function guardar() {
    startTransition(async () => {
      setError(null);
      setAviso(null);
      const limpio = cupo.trim();
      const r = await guardarConfigMonitoreo({
        cupo_periodo: limpio === '' ? null : Number(limpio),
        horizonte_rechazadas_meses: Number(horizonte),
      });
      if (!r.ok) return setError(r.error);
      await recargar();
      setAviso(
        limpio === ''
          ? 'Guardado sin tope: el motor sigue en simulación y no consume consultas.'
          : `Guardado. El motor puede gastar hasta ${limpio} consultas este mes.`,
      );
    });
  }

  function correr() {
    startTransition(async () => {
      setError(null);
      setAviso(null);
      const r = await correrBarridoAhora();
      if (!r.ok) return setError(r.error);
      await recargar();
      const d = r.data;
      setAviso(
        d.modo === 'simulacion'
          ? `Simulación: ${d.candidatos} contraparte(s) entrarían al barrido. No se consumió ninguna consulta.`
          : `Barrido: ${d.ejecutadas} consultada(s), ${d.con_delta} con cambio, ${d.notificadas} aviso(s). ${d.diferidas} quedaron para la próxima.`,
      );
    });
  }

  const consumo = estado.cupo_periodo
    ? Math.min(100, Math.round((estado.consumidas_periodo / estado.cupo_periodo) * 100))
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Radar className="h-6 w-6 text-tinta" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-tinta">Monitoreo recurrente</h1>
          <p className="text-sm text-tinta-suave">
            Vuelve a consultar solo a quien tiene la vigencia cumplida, y avisa únicamente cuando
            algo cambió. Las contrapartes que esperan tu decisión <strong>no se re-consultan</strong>:
            un pendiente tuyo no se convierte en factura.
          </p>
        </div>
      </div>

      {!estado.adoptado ? (
        <div className="p-4 rounded-lg border border-[#E5E7EB] bg-white space-y-3">
          <p className="text-sm text-tinta">
            El motor no está activado para este espacio. Al activarlo empieza a
            <strong> registrar qué barrería cada día sin consultar nada</strong>, para que puedas ver
            el volumen antes de decidir cuánto gastar.
          </p>
          <button
            onClick={activar}
            disabled={pending}
            className="px-4 py-2 rounded-lg bg-acento text-white text-sm font-medium hover:bg-acento-hover disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Activar monitoreo'}
          </button>
        </div>
      ) : (
        <>
          <div className="p-4 rounded-lg border border-[#E5E7EB] bg-white space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-tinta">Cuánto puede gastar el motor</h2>
              <span
                className={`text-xs px-2 py-1 rounded font-medium ${
                  estado.modo === 'ejecucion'
                    ? 'bg-acento/10 text-acento'
                    : 'bg-papel text-tinta-suave'
                }`}
              >
                {estado.modo === 'ejecucion' ? 'Consultando' : 'Solo simulación'}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm text-tinta">Consultas por mes</span>
                <input
                  type="number"
                  min={CUPO_MIN}
                  max={CUPO_MAX}
                  value={cupo}
                  onChange={(e) => setCupo(e.target.value)}
                  placeholder="Sin fijar"
                  className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm"
                />
                <span className="block text-xs text-tinta-suave">
                  Vacío: el motor selecciona y deja constancia, pero no consulta. Nadie elige este
                  número por ti.
                </span>
              </label>

              <label className="block space-y-1">
                <span className="text-sm text-tinta">Seguir mirando a las rechazadas</span>
                <input
                  type="number"
                  min={HORIZONTE_MIN}
                  max={HORIZONTE_MAX}
                  value={horizonte}
                  onChange={(e) => setHorizonte(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm"
                />
                <span className="block text-xs text-tinta-suave">
                  Meses desde el rechazo. Cumplido el plazo salen del barrido: el propósito es saber
                  si dejó de estar reportada, no vigilar a la persona.
                </span>
              </label>
            </div>

            {estado.cupo_periodo !== null && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-tinta-suave">
                  <span>
                    Gastadas este mes (desde el {fechaCorta(estado.periodo_desde)}):{' '}
                    {estado.consumidas_periodo} de {estado.cupo_periodo}
                  </span>
                  <span>{consumo}%</span>
                </div>
                <div className="h-2 rounded bg-papel overflow-hidden">
                  <div className="h-full bg-acento" style={{ width: `${consumo}%` }} />
                </div>
                <p className="text-xs text-tinta-suave">
                  Cuenta solo lo que gastó el motor por su cuenta. Lo que tu equipo consulta a mano
                  no descuenta de aquí.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                onClick={guardar}
                disabled={pending}
                className="px-4 py-2 rounded-lg bg-tinta text-white text-sm font-medium disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
              </button>
              <button
                onClick={correr}
                disabled={pending}
                className="px-4 py-2 rounded-lg border border-[#E5E7EB] text-sm font-medium text-tinta hover:bg-papel disabled:opacity-50 flex items-center gap-2"
              >
                <Play className="h-4 w-4" />
                Correr ahora
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E5E7EB]">
              <h2 className="text-sm font-bold text-tinta">Constancia de cada barrido</h2>
              <p className="text-xs text-tinta-suave">
                Queda fila haya o no cambios. Un barrido sin rastro no se distingue de uno que nunca
                corrió.
              </p>
            </div>
            {estado.ultimos_barridos.length === 0 ? (
              <p className="px-4 py-6 text-sm text-tinta-suave">Todavía no ha corrido ninguno.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-papel text-tinta-suave">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Día</th>
                      <th className="text-left px-4 py-2 font-medium">Modo</th>
                      <th className="text-right px-4 py-2 font-medium">Entraban</th>
                      <th className="text-right px-4 py-2 font-medium">Consultadas</th>
                      <th className="text-right px-4 py-2 font-medium">Con cambio</th>
                      <th className="text-right px-4 py-2 font-medium">Avisadas</th>
                      <th className="text-left px-4 py-2 font-medium">Pendiente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estado.ultimos_barridos.map((b) => (
                      <tr key={b.id} className="border-t border-[#E5E7EB]">
                        <td className="px-4 py-2 text-tinta">{fechaCorta(b.dia)}</td>
                        <td className="px-4 py-2 text-tinta-suave">
                          {b.modo === 'ejecucion' ? 'Consultando' : 'Simulación'}
                        </td>
                        <td className="px-4 py-2 text-right text-tinta">{b.candidatos}</td>
                        <td className="px-4 py-2 text-right text-tinta">{b.ejecutadas}</td>
                        <td className="px-4 py-2 text-right text-tinta">{b.con_delta}</td>
                        <td className="px-4 py-2 text-right text-tinta">{b.notificadas}</td>
                        <td className="px-4 py-2 text-tinta-suave">
                          {b.diferidas > 0
                            ? `${b.diferidas} para la próxima${b.corte_por_tope ? ' (topó el cupo)' : ''}`
                            : '—'}
                          {b.fallidas > 0 ? ` · ${b.fallidas} falló` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {aviso && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-acento/10 border border-acento/30 text-sm text-acento">
          <Check className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{aviso}</span>
        </div>
      )}
    </div>
  );
}
