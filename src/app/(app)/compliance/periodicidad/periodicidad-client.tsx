'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Check, Loader2, Timer } from 'lucide-react';
import {
  guardarPeriodicidad,
  listarPeriodicidad,
  type FilaPeriodicidad,
} from '@/lib/actions/compliance-periodicidad';
import {
  MESES_MAX,
  MESES_MIN,
  NIVEL_AYUDA,
  NIVEL_LABEL,
} from '@/lib/compliance/periodicidad';

export default function PeriodicidadClient({ inicial }: { inicial: FilaPeriodicidad[] }) {
  const [filas, setFilas] = useState(inicial);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function guardar(nivel: string) {
    const valor = borrador[nivel];
    if (valor === undefined) return;
    startTransition(async () => {
      setError(null);
      setAviso(null);
      const r = await guardarPeriodicidad({ nivel, meses: valor });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const recargado = await listarPeriodicidad();
      if (recargado.ok) setFilas(recargado.data);
      setBorrador((b) => {
        const { [nivel]: _, ...resto } = b;
        return resto;
      });
      setAviso(`${NIVEL_LABEL[r.data.nivel]}: se revalida cada ${r.data.meses} meses.`);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Timer className="h-6 w-6 text-tinta" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-tinta">Periodicidad de revalidación</h1>
          <p className="text-sm text-tinta-suave">
            Cada cuántos meses vuelve a consultarse una contraparte, según lo que encontró la
            última consulta. Es <strong>tu política</strong>, no una exigencia de la plataforma:
            los valores que ves son una sugerencia y los cambias cuando quieras.
          </p>
        </div>
      </div>

      <div className="p-3 rounded-lg bg-papel border border-[#E5E7EB] text-sm text-tinta-suave">
        Cuando una consulta cruza varias fuentes, manda <strong>la más corta</strong> de las que
        apliquen. Una fuente que el catálogo no reconoce se revisa con la frecuencia más corta que
        tengas configurada: mientras no sepamos qué es, se mira más seguido.
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-alerta/10 border border-alerta/30 text-[#B91C1C] text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {aviso && (
        <div className="p-3 rounded-lg bg-[var(--acento-tinte)] border border-acento/30 text-acento text-sm flex items-start gap-2">
          <Check className="h-4 w-4 mt-0.5 shrink-0" /> {aviso}
        </div>
      )}

      <div className="bg-white rounded-lg border border-[#E5E7EB] divide-y divide-[#E5E7EB]">
        {filas.map((f) => {
          const valor = borrador[f.nivel] ?? String(f.meses);
          const cambiado = borrador[f.nivel] !== undefined && borrador[f.nivel] !== String(f.meses);
          return (
            <div key={f.nivel} className="p-4 flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[16rem]">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-tinta">{NIVEL_LABEL[f.nivel]}</span>
                  {f.es_sugerido && (
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border bg-papel text-tinta-suave border-[#E5E7EB]">
                      Sugerido
                    </span>
                  )}
                </div>
                <p className="text-xs text-tinta-suave mt-0.5">{NIVEL_AYUDA[f.nivel]}</p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={MESES_MIN}
                  max={MESES_MAX}
                  value={valor}
                  onChange={(e) => setBorrador((b) => ({ ...b, [f.nivel]: e.target.value }))}
                  className="w-20 border border-[#E5E7EB] rounded-lg px-2 py-1.5 text-sm text-right"
                />
                <span className="text-sm text-tinta-suave">meses</span>
                <button
                  type="button"
                  onClick={() => guardar(f.nivel)}
                  disabled={pending || !cambiado}
                  className="inline-flex items-center gap-2 bg-tinta text-white text-sm font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40"
                >
                  {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-tinta-suave">
        Estas frecuencias son criterio del oficial de cumplimiento. La plataforma no las presenta
        como exigencia normativa, y cambiarlas no afecta las consultas ya hechas: cada consulta
        conserva la vigencia con la que se emitió.
      </p>
    </div>
  );
}
