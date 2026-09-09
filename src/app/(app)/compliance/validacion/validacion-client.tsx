'use client';

import { useState, useTransition } from 'react';
import { validarPersona } from '@/lib/actions/valida';
import { buildPDFUrl } from '@/lib/valida-urls';
import type { ConsultaResumen, ValidaResultado, TierLista, Severidad } from '@/lib/actions/valida';
import { ShieldAlert, ShieldCheck, FileDown, Search } from 'lucide-react';
import TutorialTour from '@/components/tutorial/TutorialTour';
import TutorialButton from '@/components/tutorial/TutorialButton';
import TutorialEmptyState from '@/components/tutorial/TutorialEmptyState';
import { formatFecha } from '@/lib/dates/bogota'

type Props = {
  historial: ConsultaResumen[];
  errorHistorial: string | null;
  tutorialNuncaVisto?: boolean;
};

const TIER_CLASS: Record<TierLista, string> = {
  '1_vinculante': 'bg-alerta text-white',
  '2_obligatoria': 'bg-advertencia text-tinta',
  '3_referencia': 'bg-tinta-suave text-white',
  '4_kyc_nacional': 'bg-[#2980b9] text-white',
};

const TIER_LABEL: Record<TierLista, string> = {
  '1_vinculante': 'Vinculante',
  '2_obligatoria': 'Oblig. Colombia',
  '3_referencia': 'Referencia',
  '4_kyc_nacional': 'KYC Nacional',
};

const SEVERIDAD_CLASS: Record<Severidad, string> = {
  alto: 'bg-alerta text-white',
  medio: 'bg-advertencia text-tinta',
  bajo: 'bg-[#FBBF24] text-tinta',
  informativo: 'bg-tinta-suave text-white',
  sin_hallazgo: 'bg-acento text-white',
};

export default function ValidacionClient({
  historial,
  errorHistorial,
  tutorialNuncaVisto = false,
}: Props) {
  const [tipo, setTipo] = useState<'natural' | 'juridica'>('natural');
  const [nombre, setNombre] = useState('');
  const [docTipo, setDocTipo] = useState<'CC' | 'CE' | 'NIT' | 'PAS'>('CC');
  const [docNumero, setDocNumero] = useState('');
  const [resultado, setResultado] = useState<ValidaResultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [tourTrigger, setTourTrigger] = useState(0);

  function dispararTutorial() {
    setTourTrigger(t => t + 1);
  }

  const mostrarEmpty = historial.length === 0 && !errorHistorial;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResultado(null);

    startTransition(async () => {
      const input: Parameters<typeof validarPersona>[0] = { tipo, nombre: nombre.trim() };
      if (docNumero.trim()) input.documento = { tipo: docTipo, numero: docNumero.trim() };

      const r = await validarPersona(input);
      if (r.ok) setResultado(r.data);
      else setError(r.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-acento" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-tinta">Validacion SARLAFT</h1>
          <p className="text-sm text-tinta-suave">
            Consulta contra ONU + CSN Colombia + PEP + OFAC + UE via Valida
          </p>
        </div>
        <TutorialButton onClick={dispararTutorial} />
      </div>

      {mostrarEmpty && (
        <TutorialEmptyState
          onStartDemo={dispararTutorial}
          onTryConsulta={undefined}
        />
      )}

      <form
        onSubmit={onSubmit}
        data-tutorial-target="consulta-puntual-form"
        className="bg-white rounded-lg border border-[#E5E7EB] p-6 space-y-4"
      >
        <div className="flex gap-2">
          {(['natural', 'juridica'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className={`px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                tipo === t
                  ? 'bg-tinta text-white border-tinta'
                  : 'bg-white text-tinta-suave border-[#E5E7EB] hover:border-acento'
              }`}
            >
              {t === 'natural' ? 'Persona natural' : 'Persona juridica'}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-tinta-suave font-semibold mb-2">
            {tipo === 'natural' ? 'Nombre completo' : 'Razon social'}
          </label>
          <input
            type="text"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            required
            minLength={2}
            placeholder={tipo === 'natural' ? 'Juan Perez Gomez' : 'Acme Trading SAS'}
            className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-acento"
          />
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-tinta-suave font-semibold mb-2">
              Tipo documento
            </label>
            <select
              value={docTipo}
              onChange={e => setDocTipo(e.target.value as 'CC' | 'CE' | 'NIT' | 'PAS')}
              className="w-full h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-acento bg-white"
            >
              {tipo === 'natural' ? (
                <>
                  <option value="CC">CC</option>
                  <option value="CE">CE</option>
                  <option value="PAS">Pasaporte</option>
                </>
              ) : (
                <option value="NIT">NIT</option>
              )}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs uppercase tracking-wider text-tinta-suave font-semibold mb-2">
              Numero <span className="font-light lowercase tracking-normal">(opcional)</span>
            </label>
            <input
              type="text"
              value={docNumero}
              onChange={e => setDocNumero(e.target.value)}
              placeholder="1077089147"
              className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-acento"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={pending || nombre.trim().length < 2}
          className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-tinta text-white font-semibold hover:bg-acento disabled:bg-tinta-suave disabled:cursor-not-allowed transition-colors"
        >
          <Search className="h-4 w-4" />
          {pending ? 'Consultando...' : 'Consultar'}
        </button>

        {error && (
          <div className="p-3 rounded-lg bg-alerta/10 border border-alerta/30 text-alerta text-sm flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> {error}
          </div>
        )}
      </form>

      {resultado && (
        <div
          data-tutorial-target="resultado-zona"
          className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden"
        >
          <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-wider text-tinta-suave font-semibold">Resultado</p>
              <h3 className="text-lg font-bold text-tinta mt-1">{nombre}</h3>
              <p className="text-xs text-tinta-suave font-mono">ID: {resultado.consulta_id}</p>
            </div>
            <span className={`${SEVERIDAD_CLASS[resultado.severidad]} text-[10px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider`}>
              {resultado.severidad.replace('_', ' ')}
            </span>
          </div>

          <div className="p-5 space-y-2">
            <p className="text-xs uppercase tracking-wider text-tinta-suave font-semibold">
              Coincidencias ({resultado.total_matches})
            </p>
            {resultado.matches.length === 0 ? (
              <p className="text-sm text-acento font-medium">Sin coincidencias.</p>
            ) : (
              <ul className="space-y-2">
                {resultado.matches.slice(0, 10).map((m, i) => (
                  <li key={i} className="flex items-center gap-3 py-2 border-b border-[#E5E7EB] last:border-0">
                    <span className={`${TIER_CLASS[m.tier]} text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider min-w-[110px] text-center`}>
                      {TIER_LABEL[m.tier]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-tinta truncate">{m.nombre_coincidencia}</p>
                      <p className="text-xs text-tinta-suave truncate">{m.lista_nombre}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">{(m.score * 100).toFixed(1)}%</p>
                      <p className="text-[10px] text-tinta-suave uppercase">{m.resultado}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-4 bg-papel flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-tinta-suave font-mono break-all">Hash: {resultado.hash_reporte.slice(0, 32)}...</p>
            <a
              href={buildPDFUrl(resultado.consulta_id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-tinta text-white text-xs font-semibold hover:bg-acento transition-colors"
            >
              <FileDown className="h-3.5 w-3.5" /> PDF auditable
            </a>
          </div>
        </div>
      )}

      <div
        data-tutorial-target="tab-historial"
        className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden"
      >
        <div className="p-4 border-b border-[#E5E7EB]">
          <p className="text-xs uppercase tracking-wider text-tinta-suave font-semibold">
            Historial (ultimas 50)
          </p>
        </div>
        {errorHistorial ? (
          <div className="p-6 text-sm text-alerta">Error cargando historial: {errorHistorial}</div>
        ) : historial.length === 0 ? (
          <div className="p-8 text-center text-sm text-tinta-suave">Sin consultas aun.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-papel border-b border-[#E5E7EB]">
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">Nombre</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">Doc</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">Fecha</th>
                  <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">Matches</th>
                  <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">Severidad</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">PDF</th>
                </tr>
              </thead>
              <tbody>
                {historial.map(c => (
                  <tr key={c.consulta_id} className="border-b border-[#E5E7EB] last:border-0 hover:bg-papel/60">
                    <td className="px-4 py-2.5 font-medium text-tinta">{c.nombre_consultado}</td>
                    <td className="px-4 py-2.5 text-tinta-suave">{c.documento_consultado ?? '—'}</td>
                    <td className="px-4 py-2.5 text-tinta-suave whitespace-nowrap">
                      {formatFecha(c.creada_en, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2.5 text-center font-semibold">{c.total_matches}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`${SEVERIDAD_CLASS[c.severidad]} text-[10px] font-bold px-2 py-0.5 rounded uppercase`}>
                        {c.severidad.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={buildPDFUrl(c.consulta_id)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-acento hover:text-acento-hover"
                      >
                        PDF ↓
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(tutorialNuncaVisto || tourTrigger > 0) && (
        <TutorialTour slug="valida_compliance" forceStart={tourTrigger} />
      )}
    </div>
  );
}
