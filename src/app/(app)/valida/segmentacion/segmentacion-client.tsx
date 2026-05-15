'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { ArrowLeft, AlertTriangle, CheckCircle2, Download, FileText, History, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { aplicarSegmentacionConfig } from '@/lib/actions/valida-segmentacion';
import type { DistribucionWorkspace } from '@/lib/actions/valida-score';
import type {
  ConfigPersistida,
  PesosContrapartes,
  PesosEmpleados,
  PresetSegmentacion,
  UmbralesUniverso,
} from '@/lib/valida/segmentacion-presets';
import {
  PRESETS,
  PRESET_LABEL,
  VARIABLE_CONTRAPARTE_LABEL,
  VARIABLE_EMPLEADO_LABEL,
  pesosSumanUno,
} from '@/lib/valida/segmentacion-presets';

type TabKey = 'contrapartes' | 'empleados' | 'resultados';

export default function SegmentacionClient({
  configInicial,
  distribucionInicial,
}: {
  configInicial: ConfigPersistida;
  distribucionInicial: DistribucionWorkspace | null;
}) {
  const [tab, setTab] = useState<TabKey>('contrapartes');
  const [preset, setPreset] = useState<PresetSegmentacion>(configInicial.preset);
  const [pesosC, setPesosC] = useState<PesosContrapartes>(configInicial.pesos_contrapartes);
  const [pesosE, setPesosE] = useState<PesosEmpleados>(configInicial.pesos_empleados);
  const [umbralesC, setUmbralesC] = useState<UmbralesUniverso>(configInicial.umbrales_contrapartes);
  const [umbralesE, setUmbralesE] = useState<UmbralesUniverso>(configInicial.umbrales_empleados);
  const [confirmado, setConfirmado] = useState(false);
  const [razon, setRazon] = useState('');
  const [pending, startTransition] = useTransition();
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  function aplicarPreset(nuevoPreset: PresetSegmentacion) {
    setPreset(nuevoPreset);
    if (nuevoPreset !== 'personalizado') {
      const base = PRESETS[nuevoPreset];
      setPesosC(base.pesos_contrapartes);
      setPesosE(base.pesos_empleados);
      setUmbralesC(base.umbrales_contrapartes);
      setUmbralesE(base.umbrales_empleados);
    }
    setConfirmado(false);
  }

  function actualizarPesoContraparte(key: keyof PesosContrapartes, valor: number) {
    setPesosC(prev => rebalancearPesos(prev, key, valor));
    setPreset('personalizado');
    setConfirmado(false);
  }

  function actualizarPesoEmpleado(key: keyof PesosEmpleados, valor: number) {
    setPesosE(prev => rebalancearPesos(prev, key, valor));
    setPreset('personalizado');
    setConfirmado(false);
  }

  function guardar() {
    setMensaje(null);
    if (!confirmado) {
      setMensaje({ tipo: 'error', texto: 'Debes confirmar el disclaimer antes de aplicar.' });
      return;
    }
    if (!pesosSumanUno(pesosC) || !pesosSumanUno(pesosE)) {
      setMensaje({ tipo: 'error', texto: 'Los pesos deben sumar exactamente 100 %.' });
      return;
    }
    startTransition(async () => {
      const r = await aplicarSegmentacionConfig({
        preset,
        pesos_contrapartes: pesosC,
        pesos_empleados: pesosE,
        umbrales_contrapartes: umbralesC,
        umbrales_empleados: umbralesE,
        disclaimer_aceptado: true,
        razon_cambio: razon.trim().length > 0 ? razon.trim() : null,
      });
      if (r.ok) {
        setMensaje({ tipo: 'ok', texto: `Configuración aplicada (versión ${r.version}).` });
        setRazon('');
      } else {
        setMensaje({ tipo: 'error', texto: r.error });
      }
    });
  }

  const sumaC = sumar(pesosC);
  const sumaE = sumar(pesosE);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link
          href="/valida"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B7280] hover:text-[#1A1A1A] mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver a Valida
        </Link>
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-[#10B981]" />
          <div className="flex-1">
            <h1 className="text-xl font-bold text-[#1A1A1A]">Segmentación SARLAFT</h1>
            <p className="text-sm text-[#6B7280]">
              Parametriza cómo Valida alimenta tu matriz de segmentación de riesgo. Versión actual:{' '}
              <strong>{configInicial.version}</strong>
              {configInicial.aplicada_at && (
                <> · Aplicada {new Date(configInicial.aplicada_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}</>
              )}
            </p>
          </div>
        </div>
      </div>

      <Aviso />

      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 space-y-4">
        <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">
          Preset del sector
        </p>
        <select
          value={preset}
          onChange={e => aplicarPreset(e.target.value as PresetSegmentacion)}
          className="w-full max-w-md h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A] bg-white text-sm"
        >
          {(Object.keys(PRESET_LABEL) as PresetSegmentacion[]).map(p => (
            <option key={p} value={p}>{PRESET_LABEL[p]}</option>
          ))}
        </select>
        {preset !== 'personalizado' && (
          <button
            type="button"
            onClick={() => aplicarPreset(preset)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1A1A1A] hover:text-[#10B981]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restaurar valores del preset
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b border-[#E5E7EB]">
        <TabButton active={tab === 'contrapartes'} onClick={() => setTab('contrapartes')}>
          Contrapartes
        </TabButton>
        <TabButton active={tab === 'empleados'} onClick={() => setTab('empleados')}>
          Empleados
        </TabButton>
        <TabButton active={tab === 'resultados'} onClick={() => setTab('resultados')}>
          Resultados
        </TabButton>
      </div>

      {tab === 'contrapartes' && (
        <PanelUniverso
          titulo="Pesos de factores · Contrapartes"
          variables={pesosC}
          labels={VARIABLE_CONTRAPARTE_LABEL}
          umbrales={umbralesC}
          suma={sumaC}
          onPesoChange={(k, v) => actualizarPesoContraparte(k as keyof PesosContrapartes, v)}
          onUmbralChange={u => { setUmbralesC(u); setConfirmado(false); }}
        />
      )}

      {tab === 'empleados' && (
        <PanelUniverso
          titulo="Pesos de factores · Empleados"
          variables={pesosE}
          labels={VARIABLE_EMPLEADO_LABEL}
          umbrales={umbralesE}
          suma={sumaE}
          onPesoChange={(k, v) => actualizarPesoEmpleado(k as keyof PesosEmpleados, v)}
          onUmbralChange={u => { setUmbralesE(u); setConfirmado(false); }}
        />
      )}

      {tab === 'resultados' && <PanelResultados distribucion={distribucionInicial} />}

      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 space-y-4">
        <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-[#F59E0B]" />
          Confirmación obligatoria
        </p>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmado}
            onChange={e => setConfirmado(e.target.checked)}
            className="mt-1"
          />
          <span className="text-sm text-[#1A1A1A] leading-relaxed">
            Confirmo que esta metodología refleja la realidad de mi organización y será documentada
            en mi Manual SARLAFT. Soy consciente de que las decisiones de clasificación de clientes,
            debida diligencia ampliada y reporte ROS son indelegables y corresponden al oficial de
            cumplimiento.
          </span>
        </label>
        <div>
          <label className="block text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
            Razón del cambio (opcional)
          </label>
          <textarea
            value={razon}
            onChange={e => setRazon(e.target.value)}
            rows={2}
            maxLength={400}
            placeholder="Ej: Ajuste anual de pesos según recomendación de auditoría interna."
            className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A] text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={guardar}
            disabled={pending || !confirmado || !pesosSumanUno(pesosC) || !pesosSumanUno(pesosE)}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-[#10B981] text-white font-semibold text-sm hover:bg-[#059669] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
          >
            <Save className="h-4 w-4" />
            {pending ? 'Aplicando…' : 'Aplicar configuración'}
          </button>
          <Link
            href="/valida/segmentacion/bitacora"
            className="inline-flex items-center gap-2 h-11 px-5 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#1A1A1A] hover:bg-[#F5F4F2] transition-colors"
          >
            <History className="h-4 w-4" />
            Ver bitácora
          </Link>
          {configInicial.version > 0 && (
            <a
              href="/api/valida/segmentacion/pdf"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 h-11 px-5 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#1A1A1A] hover:bg-[#F5F4F2] transition-colors"
            >
              <Download className="h-4 w-4" />
              Exportar PDF firmable
            </a>
          )}
        </div>
        {mensaje && (
          <div
            className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
              mensaje.tipo === 'ok'
                ? 'bg-[#10B981]/10 text-[#065F46] border border-[#10B981]/30'
                : 'bg-[#EF4444]/10 text-[#B91C1C] border border-[#EF4444]/30'
            }`}
          >
            {mensaje.tipo === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {mensaje.texto}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Subcomponentes ───────────────────────────────────────────────────────

function Aviso() {
  return (
    <div className="bg-[#F5F4F2] border-l-2 border-[#6B7280] rounded p-4">
      <p className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-bold text-[#6B7280] mb-1.5">
        <AlertTriangle className="h-4 w-4" />
        Recordatorio importante
      </p>
      <p className="text-sm text-[#1A1A1A] leading-relaxed">
        Esta herramienta es una sugerencia inicial basada en el sector que indicas. Tu organización es
        responsable de revisar, ajustar y documentar la metodología como propia en su Manual SARLAFT.
        MéTRIK provee la herramienta, no la metodología. Las decisiones de clasificación, debida
        diligencia y reporte ROS son indelegables.
      </p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
        active ? 'border-[#1A1A1A] text-[#1A1A1A]' : 'border-transparent text-[#6B7280] hover:text-[#1A1A1A]'
      }`}
    >
      {children}
    </button>
  );
}

function PanelUniverso({
  titulo,
  variables,
  labels,
  umbrales,
  suma,
  onPesoChange,
  onUmbralChange,
}: {
  titulo: string;
  variables: Record<string, number>;
  labels: Record<string, string>;
  umbrales: UmbralesUniverso;
  suma: number;
  onPesoChange: (key: string, valor: number) => void;
  onUmbralChange: (u: UmbralesUniverso) => void;
}) {
  const sumaPct = Math.round(suma * 100);
  const sumaOk = Math.abs(suma - 1.0) < 0.001;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-bold text-[#1A1A1A]">{titulo}</p>
          <span
            className={`text-xs font-mono font-semibold px-2 py-1 rounded ${
              sumaOk ? 'bg-[#10B981]/10 text-[#059669]' : 'bg-[#EF4444]/10 text-[#B91C1C]'
            }`}
          >
            Suma: {sumaPct} %
          </span>
        </div>
        {Object.entries(variables).map(([k, v]) => (
          <div key={k} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[#1A1A1A]">{labels[k] ?? k}</span>
              <span className="text-xs font-mono font-semibold text-[#6B7280]">{Math.round(v * 100)} %</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(v * 100)}
              onChange={e => onPesoChange(k, parseInt(e.target.value, 10) / 100)}
              className="w-full accent-[#10B981]"
            />
          </div>
        ))}
        {!sumaOk && (
          <p className="text-xs text-[#B91C1C]">
            Los pesos no suman 100 %. El sistema rebalancea automáticamente cuando mueves un slider,
            pero verifica que todos los valores reflejen tu intención.
          </p>
        )}
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 space-y-4">
        <p className="text-sm font-bold text-[#1A1A1A]">Umbrales de clasificación</p>
        <UmbralRow
          label="Alto riesgo si puntaje ≥"
          color="bg-[#EF4444]"
          valor={umbrales.alto_min}
          onChange={v => onUmbralChange({ ...umbrales, alto_min: v })}
          frecuencia={umbrales.frec_alto_meses}
          onFrecChange={v => onUmbralChange({ ...umbrales, frec_alto_meses: v })}
        />
        <UmbralRow
          label="Medio riesgo si puntaje ≥"
          color="bg-[#F59E0B]"
          valor={umbrales.medio_min}
          onChange={v => onUmbralChange({ ...umbrales, medio_min: v })}
          frecuencia={umbrales.frec_medio_meses}
          onFrecChange={v => onUmbralChange({ ...umbrales, frec_medio_meses: v })}
        />
        <UmbralRow
          label="Bajo riesgo si puntaje <"
          color="bg-[#10B981]"
          valor={umbrales.medio_min}
          onChange={() => {}}
          readonly
          frecuencia={umbrales.frec_bajo_meses}
          onFrecChange={v => onUmbralChange({ ...umbrales, frec_bajo_meses: v })}
        />
      </div>
    </div>
  );
}

function UmbralRow({
  label,
  color,
  valor,
  onChange,
  frecuencia,
  onFrecChange,
  readonly,
}: {
  label: string;
  color: string;
  valor: number;
  onChange: (v: number) => void;
  frecuencia: number;
  onFrecChange: (v: number) => void;
  readonly?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm text-[#1A1A1A]">
            <span className={`${color} h-2.5 w-2.5 rounded-full inline-block`} />
            {label}
          </span>
          <span className="text-xs font-mono font-semibold text-[#6B7280]">{valor.toFixed(2)}</span>
        </div>
        {!readonly && (
          <input
            type="range"
            min="100"
            max="300"
            value={Math.round(valor * 100)}
            onChange={e => onChange(parseInt(e.target.value, 10) / 100)}
            className="w-full accent-[#10B981]"
          />
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-[#6B7280] whitespace-nowrap">Revisión cada</label>
        <input
          type="number"
          min={1}
          max={36}
          value={frecuencia}
          onChange={e => onFrecChange(Math.max(1, Math.min(36, parseInt(e.target.value, 10) || 1)))}
          className="w-16 h-8 px-2 rounded border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A] text-sm"
        />
        <span className="text-xs text-[#6B7280]">meses</span>
      </div>
    </div>
  );
}

function PanelResultados({ distribucion }: { distribucion: DistribucionWorkspace | null }) {
  if (!distribucion || (distribucion.contrapartes.total === 0 && distribucion.empleados.total === 0)) {
    return (
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-8 text-center text-sm text-[#6B7280]">
        <p className="font-semibold text-[#1A1A1A] mb-1">Distribución por nivel de riesgo</p>
        <p>
          Aún no hay negocios con score calculado. Configura los datos SARLAFT en el detalle de cada
          negocio (sección «Riesgo SARLAFT») para que aparezcan aquí.
        </p>
        <p className="text-xs mt-3">
          <FileText className="h-3.5 w-3.5 inline mr-1 mb-0.5" />
          El score se recalcula automáticamente cada vez que corres una consulta Valida sobre el negocio.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DistribucionBloque
        titulo="Contrapartes"
        valores={distribucion.contrapartes}
      />
      <DistribucionBloque
        titulo="Empleados"
        valores={distribucion.empleados}
      />
    </div>
  );
}

function DistribucionBloque({ titulo, valores }: { titulo: string; valores: DistribucionWorkspace['contrapartes'] }) {
  const total = valores.total || 1;
  const colores: Record<'alto' | 'medio' | 'bajo', string> = {
    alto: 'bg-[#EF4444]',
    medio: 'bg-[#F59E0B]',
    bajo: 'bg-[#10B981]',
  };
  const labels: Record<'alto' | 'medio' | 'bajo', string> = {
    alto: 'Alto',
    medio: 'Medio',
    bajo: 'Bajo',
  };
  const niveles: Array<'alto' | 'medio' | 'bajo'> = ['alto', 'medio', 'bajo'];

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-bold text-[#1A1A1A]">{titulo}</p>
        <p className="text-xs text-[#6B7280] font-mono">{valores.total} con score</p>
      </div>
      {valores.total === 0 ? (
        <p className="text-xs text-[#9CA3AF]">Sin negocios con score en este universo.</p>
      ) : (
        <div className="space-y-2">
          {niveles.map(n => {
            const v = valores[n];
            const pct = Math.round((v / total) * 100);
            return (
              <div key={n} className="flex items-center gap-3">
                <span className="text-xs font-semibold text-[#1A1A1A] w-12">{labels[n]}</span>
                <div className="flex-1 h-3 bg-[#F5F4F2] rounded-full overflow-hidden">
                  <div
                    className={`h-full ${colores[n]} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-[#6B7280] w-16 text-right">
                  {v} ({pct}%)
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function sumar(o: Record<string, number>): number {
  return Object.values(o).reduce((acc, v) => acc + v, 0);
}

function rebalancearPesos<T extends Record<string, number>>(prev: T, keyCambiado: keyof T, nuevoValor: number): T {
  const clamp = Math.max(0, Math.min(1, nuevoValor));
  const restantes = Object.keys(prev).filter(k => k !== keyCambiado);
  const sumaRestante = restantes.reduce((acc, k) => acc + prev[k], 0);
  const restanteTarget = 1 - clamp;

  const out = { ...prev, [keyCambiado]: clamp } as T;

  if (sumaRestante > 0.0001 && restantes.length > 0) {
    // Proporcional
    for (const k of restantes) {
      const ratio = prev[k] / sumaRestante;
      out[k as keyof T] = restanteTarget * ratio as T[keyof T];
    }
  } else if (restantes.length > 0) {
    // Si todos los restantes son 0, repartir igual
    const cada = restanteTarget / restantes.length;
    for (const k of restantes) {
      out[k as keyof T] = cada as T[keyof T];
    }
  }

  return out;
}
