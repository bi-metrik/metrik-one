'use client';

import { useState, useTransition } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  ListChecks,
  Search,
  Upload,
  User,
  Users,
} from 'lucide-react';
import TutorialTour from '@/components/tutorial/TutorialTour';
import TutorialButton from '@/components/tutorial/TutorialButton';
import {
  consultaDualPersistente,
  consultaDualBatch,
  descargarPlantillaBatch,
  type DualConsultaPersistida,
  type DualSeveridad,
  type DualTipo,
  type InformaMatch,
} from '@/lib/actions/compliance-dual';

const SEVERIDAD_CLASS: Record<DualSeveridad, string> = {
  alto: 'bg-[#EF4444] text-white',
  sin_hallazgo: 'bg-[#10B981] text-white',
  error: 'bg-[#1A1A1A] text-white',
};

const SEVERIDAD_LABEL: Record<DualSeveridad, string> = {
  alto: 'Alto',
  sin_hallazgo: 'Sin hallazgo',
  error: 'Error',
};

type TabKey = 'puntual' | 'masiva';

function base64ToBlob(b64: string, mime: string): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type ListasClientProps = {
  tutorialNuncaVisto?: boolean;
};

export default function ListasClient({ tutorialNuncaVisto = false }: ListasClientProps) {
  const [tab, setTab] = useState<TabKey>('puntual');
  const [tourTrigger, setTourTrigger] = useState(0);

  function dispararTutorial() {
    setTourTrigger(t => t + 1);
    setTab('puntual');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ListChecks className="h-6 w-6 text-[#1A1A1A]" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Consulta de Listas Restrictivas</h1>
          <p className="text-sm text-[#6B7280]">
            Consulta puntual o masiva contra listas vinculantes y de referencia.
          </p>
        </div>
        <TutorialButton onClick={dispararTutorial} />
      </div>

      <div className="flex gap-1 border-b border-[#E5E7EB]">
        <TabButton
          active={tab === 'puntual'}
          onClick={() => setTab('puntual')}
          icon={<Search className="h-4 w-4" />}
        >
          Consulta puntual
        </TabButton>
        <TabButton
          active={tab === 'masiva'}
          onClick={() => setTab('masiva')}
          icon={<FileSpreadsheet className="h-4 w-4" />}
          dataTutorialTarget="tab-masiva"
        >
          Carga masiva (XLSX)
        </TabButton>
      </div>

      {tab === 'puntual' && <ConsultaPuntualForm />}
      {tab === 'masiva' && <ConsultaMasivaForm />}

      {(tutorialNuncaVisto || tourTrigger > 0) && (
        <TutorialTour slug="compliance_listas_dual" forceStart={tourTrigger} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
  dataTutorialTarget,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  dataTutorialTarget?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tutorial-target={dataTutorialTarget}
      className={`-mb-px inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? 'border-[#1A1A1A] text-[#1A1A1A]'
          : 'border-transparent text-[#6B7280] hover:text-[#1A1A1A]'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Tab: Consulta puntual (formulario unificado) ──────────────────────────

function ConsultaPuntualForm() {
  const [tipo, setTipo] = useState<DualTipo>('natural');
  const [identificacion, setIdentificacion] = useState('');
  const [nombre, setNombre] = useState('');
  const [resultado, setResultado] = useState<DualConsultaPersistida | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const idTrim = identificacion.trim();
  const nombreTrim = nombre.trim();
  const isEmpty = idTrim.length === 0 && nombreTrim.length === 0;

  const labelDocumento = tipo === 'juridica' ? 'NIT' : 'Cédula';
  const placeholderDocumento = tipo === 'juridica' ? '900123456' : '1077089147';
  const labelNombre = tipo === 'juridica' ? 'Razón social' : 'Nombre completo';
  const placeholderNombre =
    tipo === 'juridica' ? 'Acme Trading SAS' : 'Juan Pérez Gómez';

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setValidation(null);
    setResultado(null);

    if (isEmpty) {
      setValidation('Debes llenar al menos uno de los dos campos.');
      return;
    }

    startTransition(async () => {
      const r = await consultaDualPersistente({
        tipo,
        ...(idTrim ? { identificacion: idTrim } : {}),
        ...(nombreTrim ? { nombre: nombreTrim } : {}),
      });
      if (r.ok) setResultado(r.data);
      else setError(r.error);
    });
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={onSubmit}
        data-tutorial-target="consulta-puntual-form"
        className="bg-white rounded-lg border border-[#E5E7EB] p-6 space-y-4"
      >
        <SelectorTipoPersona
          tipo={tipo}
          onChange={(t) => {
            setTipo(t);
            setValidation(null);
          }}
        />

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
              {labelDocumento}{' '}
              <span className="text-[#9CA3AF] normal-case font-medium">(opcional)</span>
            </label>
            <input
              type="text"
              value={identificacion}
              onChange={(e) => {
                setIdentificacion(e.target.value);
                if (validation) setValidation(null);
              }}
              placeholder={placeholderDocumento}
              className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A]"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
              {labelNombre}{' '}
              <span className="text-[#9CA3AF] normal-case font-medium">(opcional)</span>
            </label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => {
                setNombre(e.target.value);
                if (validation) setValidation(null);
              }}
              placeholder={placeholderNombre}
              className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A]"
            />
          </div>
        </div>

        <p className="text-xs text-[#6B7280]">
          Llena al menos uno de los dos. Mejor si llenas ambos: la coincidencia es más precisa.
        </p>

        <button
          type="submit"
          disabled={pending || isEmpty}
          className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-[#1A1A1A] text-white font-semibold hover:bg-[#374151] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
        >
          <Search className="h-4 w-4" />
          {pending ? 'Consultando…' : 'Consultar'}
        </button>

        {validation && <ErrorBox msg={validation} />}
        {error && <ErrorBox msg={error} />}
      </form>

      {resultado && (
        <div data-tutorial-target="resultado-zona">
          <ResultadoConsulta data={resultado} nombreConsultado={nombreTrim || idTrim} />
        </div>
      )}
    </div>
  );
}

// ─── Tab: Masiva (XLSX) ────────────────────────────────────────────────────

function ConsultaMasivaForm() {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingTpl, startTplTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!archivo) {
      setError('Selecciona un archivo XLSX');
      return;
    }
    const fd = new FormData();
    fd.append('archivo', archivo);
    startTransition(async () => {
      const r = await consultaDualBatch(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const blob = base64ToBlob(
        r.data.base64,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      triggerDownload(blob, r.data.filename);
      setInfo(`Resultado descargado: ${r.data.filename}`);
      setArchivo(null);
      const input = document.getElementById('archivo-batch') as HTMLInputElement | null;
      if (input) input.value = '';
    });
  }

  function descargarPlantilla() {
    setError(null);
    setInfo(null);
    startTplTransition(async () => {
      const r = await descargarPlantillaBatch();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const blob = base64ToBlob(
        r.data.base64,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      triggerDownload(blob, r.data.filename);
    });
  }

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-bold text-[#1A1A1A]">Carga masiva (XLSX)</h3>
          <p className="text-sm text-[#6B7280] mt-1">
            Sube un XLSX con la plantilla y descarga el resultado con las coincidencias anexadas.
          </p>
        </div>
        <button
          type="button"
          onClick={descargarPlantilla}
          disabled={pendingTpl}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#1A1A1A] hover:bg-[#F5F4F2] disabled:opacity-50 transition-colors"
        >
          <Download className="h-4 w-4" />
          {pendingTpl ? 'Descargando…' : 'Descargar plantilla'}
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <label
          htmlFor="archivo-batch"
          className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-[#E5E7EB] hover:border-[#1A1A1A] rounded-lg p-8 cursor-pointer transition-colors"
        >
          <Upload className="h-8 w-8 text-[#6B7280]" />
          <div className="text-center">
            <p className="text-sm font-semibold text-[#1A1A1A]">
              {archivo ? archivo.name : 'Arrastra o selecciona un archivo XLSX'}
            </p>
            <p className="text-xs text-[#6B7280] mt-1">
              Solo .xlsx — hasta 5 MB
            </p>
          </div>
          <input
            id="archivo-batch"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={e => setArchivo(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </label>

        <button
          type="submit"
          disabled={pending || !archivo}
          className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-[#1A1A1A] text-white font-semibold hover:bg-[#374151] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
        >
          <Upload className="h-4 w-4" />
          {pending ? 'Procesando…' : 'Consultar archivo'}
        </button>

        {error && <ErrorBox msg={error} />}
        {info && (
          <div className="p-3 rounded-lg bg-[#10B981]/10 border border-[#10B981]/30 text-[#065F46] text-sm flex items-center gap-2">
            <Check className="h-4 w-4" /> {info}
          </div>
        )}
      </form>
    </div>
  );
}

// ─── Componentes compartidos ───────────────────────────────────────────────

function SelectorTipoPersona({
  tipo,
  onChange,
}: {
  tipo: DualTipo;
  onChange: (t: DualTipo) => void;
}) {
  return (
    <div className="flex gap-2">
      {(
        [
          { v: 'natural', label: 'Persona natural', icon: <User className="h-4 w-4" /> },
          { v: 'juridica', label: 'Persona jurídica', icon: <Users className="h-4 w-4" /> },
        ] as const
      ).map(o => {
        const active = tipo === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
              active
                ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                : 'bg-white text-[#6B7280] border-[#E5E7EB] hover:border-[#1A1A1A]'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ResultadoConsulta({
  data,
  nombreConsultado,
}: {
  data: DualConsultaPersistida;
  nombreConsultado: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
      <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">Resultado</p>
          <h3 className="text-lg font-bold text-[#1A1A1A] mt-1 truncate">
            {nombreConsultado || '—'}
          </h3>
          <p className="text-xs text-[#6B7280] font-mono">ID: {data.consulta_local_id}</p>
        </div>
        <span
          className={`${SEVERIDAD_CLASS[data.severidad]} text-[10px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider`}
        >
          {SEVERIDAD_LABEL[data.severidad]}
        </span>
      </div>

      <div className="p-5 space-y-3">
        <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">
          Coincidencias ({data.total_matches})
        </p>
        {data.matches.length === 0 ? (
          <p className="text-sm text-[#10B981] font-medium flex items-center gap-1.5">
            <Check className="h-4 w-4" />
            La consulta no arrojó coincidencias en las listas restrictivas evaluadas.
          </p>
        ) : (
          <ListaCoincidencias matches={data.matches} />
        )}
      </div>
    </div>
  );
}

function ListaCoincidencias({ matches }: { matches: InformaMatch[] }) {
  return (
    <ul className="divide-y divide-[#E5E7EB]">
      {matches.slice(0, 20).map((m, i) => (
        <li key={i} className="py-3 flex flex-col sm:flex-row sm:items-start sm:gap-4">
          <div className="sm:w-32 shrink-0">
            <p className="text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold">
              Lista
            </p>
            <p className="text-sm font-semibold text-[#1A1A1A] mt-0.5 break-words">{m.lista}</p>
          </div>
          <div className="flex-1 min-w-0 mt-2 sm:mt-0">
            <p className="text-sm font-medium text-[#1A1A1A]">{m.nombre}</p>
            {m.documento && (
              <p className="text-xs text-[#6B7280] font-mono mt-0.5">{m.documento}</p>
            )}
            {m.fundamento && (
              <p className="text-xs text-[#6B7280] mt-1.5 leading-relaxed">{m.fundamento}</p>
            )}
          </div>
        </li>
      ))}
      {matches.length > 20 && (
        <li className="py-3 text-xs text-[#6B7280] text-center italic">
          Mostrando 20 de {matches.length} coincidencias.
        </li>
      )}
    </ul>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#B91C1C] text-sm flex items-center gap-2">
      <AlertTriangle className="h-4 w-4" /> {msg}
    </div>
  );
}
