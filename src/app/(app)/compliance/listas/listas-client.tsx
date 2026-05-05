'use client';

import { useState, useTransition } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  Search,
  Upload,
  User,
  Users,
} from 'lucide-react';
import {
  consultaDual,
  consultaDualBatch,
  descargarPlantillaBatch,
  type DualConsultaPublica,
  type DualTipo,
  type InformaMatch,
} from '@/lib/actions/compliance-dual';

type TabKey = 'documento' | 'nombre' | 'masiva';

const TIPO_DOC_OPCIONES: Array<{ value: 'CC' | 'CE' | 'NIT' | 'PAS'; label: string; tipo: DualTipo }> = [
  { value: 'CC', label: 'CC', tipo: 'natural' },
  { value: 'CE', label: 'CE', tipo: 'natural' },
  { value: 'PAS', label: 'Pasaporte', tipo: 'natural' },
  { value: 'NIT', label: 'NIT', tipo: 'juridica' },
];

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

export default function ListasClient() {
  const [tab, setTab] = useState<TabKey>('documento');

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-[#E5E7EB]">
        <TabButton active={tab === 'documento'} onClick={() => setTab('documento')} icon={<FileText className="h-4 w-4" />}>
          Por documento
        </TabButton>
        <TabButton active={tab === 'nombre'} onClick={() => setTab('nombre')} icon={<User className="h-4 w-4" />}>
          Por nombre
        </TabButton>
        <TabButton active={tab === 'masiva'} onClick={() => setTab('masiva')} icon={<FileSpreadsheet className="h-4 w-4" />}>
          Consulta masiva
        </TabButton>
      </div>

      {tab === 'documento' && <ConsultaDocumentoForm />}
      {tab === 'nombre' && <ConsultaNombreForm />}
      {tab === 'masiva' && <ConsultaMasivaForm />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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

// ─── Tab: Por documento ────────────────────────────────────────────────────

function ConsultaDocumentoForm() {
  const [tipo, setTipo] = useState<DualTipo>('natural');
  const [tipoDoc, setTipoDoc] = useState<'CC' | 'CE' | 'NIT' | 'PAS'>('CC');
  const [identificacion, setIdentificacion] = useState('');
  const [resultado, setResultado] = useState<DualConsultaPublica | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onTipoChange(t: DualTipo) {
    setTipo(t);
    setTipoDoc(t === 'juridica' ? 'NIT' : 'CC');
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResultado(null);
    startTransition(async () => {
      const r = await consultaDual({
        modo: 'documento',
        tipo,
        identificacion: identificacion.trim(),
      });
      if (r.ok) setResultado(r.data);
      else setError(r.error);
    });
  }

  const docOpciones = TIPO_DOC_OPCIONES.filter(o => o.tipo === tipo);

  return (
    <div className="space-y-5">
      <form
        onSubmit={onSubmit}
        className="bg-white rounded-lg border border-[#E5E7EB] p-6 space-y-4"
      >
        <SelectorTipoPersona tipo={tipo} onChange={onTipoChange} />

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
              Tipo documento
            </label>
            <select
              value={tipoDoc}
              onChange={e => setTipoDoc(e.target.value as 'CC' | 'CE' | 'NIT' | 'PAS')}
              className="w-full h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A] bg-white"
            >
              {docOpciones.map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
              Numero de documento
            </label>
            <input
              type="text"
              value={identificacion}
              onChange={e => setIdentificacion(e.target.value)}
              required
              minLength={3}
              placeholder="1077089147"
              className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A]"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={pending || identificacion.trim().length < 3}
          className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-[#1A1A1A] text-white font-semibold hover:bg-[#374151] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
        >
          <Search className="h-4 w-4" />
          {pending ? 'Consultando…' : 'Consultar'}
        </button>

        {error && <ErrorBox msg={error} />}
      </form>

      {resultado && <ResultadoConsulta data={resultado} />}
    </div>
  );
}

// ─── Tab: Por nombre ───────────────────────────────────────────────────────

function ConsultaNombreForm() {
  const [tipo, setTipo] = useState<DualTipo>('natural');
  const [nombre, setNombre] = useState('');
  const [resultado, setResultado] = useState<DualConsultaPublica | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResultado(null);
    startTransition(async () => {
      const r = await consultaDual({
        modo: 'nombre',
        tipo,
        nombre: nombre.trim(),
      });
      if (r.ok) setResultado(r.data);
      else setError(r.error);
    });
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={onSubmit}
        className="bg-white rounded-lg border border-[#E5E7EB] p-6 space-y-4"
      >
        <SelectorTipoPersona tipo={tipo} onChange={setTipo} />

        <div>
          <label className="block text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
            {tipo === 'natural' ? 'Nombre completo' : 'Razón social'}
          </label>
          <input
            type="text"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            required
            minLength={3}
            placeholder={tipo === 'natural' ? 'Juan Pérez Gómez' : 'Acme Trading SAS'}
            className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A]"
          />
        </div>

        <button
          type="submit"
          disabled={pending || nombre.trim().length < 3}
          className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-[#1A1A1A] text-white font-semibold hover:bg-[#374151] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
        >
          <Search className="h-4 w-4" />
          {pending ? 'Consultando…' : 'Consultar'}
        </button>

        {error && <ErrorBox msg={error} />}
      </form>

      {resultado && <ResultadoConsulta data={resultado} />}
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
          <h3 className="text-base font-bold text-[#1A1A1A]">Consulta masiva</h3>
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

function ResultadoConsulta({ data }: { data: DualConsultaPublica }) {
  if (data.total_matches === 0) return <SinCoincidencias />;
  return <ConCoincidencias matches={data.matches} total={data.total_matches} />;
}

function SinCoincidencias() {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-[#10B981]/10 flex items-center justify-center">
          <Check className="h-5 w-5 text-[#10B981]" />
        </div>
        <div>
          <p className="text-base font-bold text-[#1A1A1A]">Sin coincidencias en listas</p>
          <p className="text-sm text-[#6B7280] mt-0.5">
            La consulta no arrojó resultados en las listas restrictivas evaluadas.
          </p>
        </div>
      </div>
    </div>
  );
}

function ConCoincidencias({
  matches,
  total,
}: {
  matches: InformaMatch[];
  total: number;
}) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
      <div className="p-5 border-b border-[#E5E7EB] bg-[#FEF3C7]/50">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-[#B45309]" />
          <div>
            <p className="text-base font-bold text-[#1A1A1A]">
              {total} {total === 1 ? 'coincidencia encontrada' : 'coincidencias encontradas'}
            </p>
            <p className="text-sm text-[#6B7280] mt-0.5">
              Revisa cada coincidencia y aplica el procedimiento de debida diligencia.
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#F5F4F2] border-b border-[#E5E7EB]">
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Lista
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Nombre encontrado
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Documento
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Fundamento
              </th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m, i) => (
              <tr key={i} className="border-b border-[#E5E7EB] last:border-0 align-top">
                <td className="px-4 py-3 font-semibold text-[#1A1A1A]">{m.lista}</td>
                <td className="px-4 py-3 text-[#1A1A1A]">{m.nombre}</td>
                <td className="px-4 py-3 text-[#6B7280] font-mono text-xs">
                  {m.documento ?? '—'}
                </td>
                <td className="px-4 py-3 text-[#6B7280] text-xs leading-relaxed">
                  {m.fundamento ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#B91C1C] text-sm flex items-center gap-2">
      <AlertTriangle className="h-4 w-4" /> {msg}
    </div>
  );
}
