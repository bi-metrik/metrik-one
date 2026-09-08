'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  Building2,
  Check,
  ChevronDown,
  FileUp,
  Loader2,
  Lock,
  PenLine,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  User,
} from 'lucide-react';
import {
  abrirVinculacion,
  aceptarCondiciones,
  confirmarCampos,
  firmarConCodigo,
  pedirCodigoDeFirma,
  leerDocumento,
  pedirUrlDeSubida,
  guardarSocio,
  retirarSocio,
  traducirErrorFirma,
  type VistaPublica,
} from '@/lib/actions/vinculacion-publica';
import {
  FORM_SOCIO_VACIO,
  LARGO_OTP,
  MOTIVOS_PARADA,
  MOTIVO_PARADA_AYUDA,
  MOTIVO_PARADA_LABEL,
  PASO_LABEL,
  POR_QUE_LOS_SOCIOS,
  SLOT_SOPORTE_BF,
  TAMANO_MAX_MB,
  faltaEnFormSocio,
  faltasDe,
  fraseFalta,
  nombrePedido,
  normalizarOtp,
  notaPedido,
  notaSoporteBf,
  pasosVisibles,
  resumenCadena,
  textoParticipacion,
  veredictoLectura,
  vistaPreviaCampos,
  otpCompleto,
  textosAceptacion,
  archivoSoltado,
  validarArchivo,
  type FormSocio,
  type MotivoParada,
  type PasoPublico,
  type Socio,
  type VeredictoLectura,
} from '@/lib/compliance/vinculacion-publica';

/** El color dice lo mismo que la frase, para quien solo mira. */
const TONO_LECTURA: Record<VeredictoLectura['tono'], string> = {
  ok: 'text-[#059669]',
  ojo: 'text-[#B45309]',
  espera: 'text-[#6B7280]',
  falla: 'text-[#B91C1C]',
};

type LecturaEnPantalla = {
  veredicto: VeredictoLectura;
  previa: { slug: string; texto: string }[];
};

export default function FormularioClient({
  token,
  inicial,
}: {
  token: string;
  inicial: VistaPublica;
}) {
  const [v, setV] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>({});
  const [abierto, setAbierto] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [borradores, setBorradores] = useState<Record<string, string>>({});
  const [otp, setOtp] = useState('');
  const [enviadoA, setEnviadoA] = useState<string | null>(null);
  const [nombreFirmante, setNombreFirmante] = useState('');
  const [docFirmante, setDocFirmante] = useState('');
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [encima, setEncima] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState<string | null>(null);
  const [lecturas, setLecturas] = useState<Record<string, LecturaEnPantalla>>({});
  const [formSocio, setFormSocio] = useState<FormSocio | null>(null);
  const [socioEditado, setSocioEditado] = useState<string | null>(null);
  const [socioPadre, setSocioPadre] = useState<string | null>(null);
  const [erroresSocio, setErroresSocio] = useState<Partial<Record<keyof FormSocio, string>>>({});
  const [porRetirar, setPorRetirar] = useState<string | null>(null);
  const [subiendoSoporte, setSubiendoSoporte] = useState<string | null>(null);
  const inputsSoporte = useRef<Record<string, HTMLInputElement | null>>({});

  // Soltar un archivo FUERA de un bloque hace que el navegador lo abra y se
  // lleve la pestaña por delante. La persona pierde el formulario por apuntar
  // mal, que es exactamente lo que pasa cuando uno arrastra. Se anula el
  // comportamiento por defecto en toda la ventana; los bloques siguen
  // recibiendo lo suyo porque ellos también llaman a preventDefault.
  useEffect(() => {
    const anular = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', anular);
    window.addEventListener('drop', anular);
    return () => {
      window.removeEventListener('dragover', anular);
      window.removeEventListener('drop', anular);
    };
  }, []);

  function soltar(slot: string, lista: FileList | null) {
    setEncima(null);
    const files = Array.from(lista ?? []);
    const r = archivoSoltado(files);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    subir(slot, files[r.indice]);
  }

  const textos = useMemo(() => textosAceptacion(v.marca.nombre), [v.marca.nombre]);
  const acento = v.marca.colorPrimario ?? '#1A1A1A';
  const quien =
    v.sujeto.razon_social?.trim() || v.sujeto.nombre?.trim() || 'tu empresa';
  const todasMarcadas = textos.every((t) => marcadas[t.tipo]);
  const porConfirmar = v.campos.filter((c) => c.requiere_confirmacion && !c.confirmado);

  async function recargar() {
    const r = await abrirVinculacion(token);
    if (r.ok) setV(r.data);
  }

  function aceptar() {
    startTransition(async () => {
      setError(null);
      const r = await aceptarCondiciones(token);
      if (!r.ok) {
        setError('No se pudo registrar tu autorización. Vuelve a intentar.');
        return;
      }
      await recargar();
    });
  }

  /**
   * La lectura corre FUERA de la transición: puede tardar hasta cuarenta
   * segundos y dejar el formulario entero bloqueado ese rato obligaría a la
   * persona a mirar una rueda antes de poder subir el documento siguiente.
   */
  async function leerAhora(slot: string, docId: string) {
    setLeyendo(slot);
    try {
      const r = await leerDocumento(token, docId);
      if (!r.ok) {
        // El documento YA está subido: el que falló fue el lector. Decirle que
        // vuelva a intentar lo mandaría a subir dos veces lo mismo.
        setLecturas((m) => ({
          ...m,
          [slot]: {
            veredicto: {
              tono: 'espera',
              texto: 'Lo recibimos. No pudimos leerlo en este momento, lo leemos más tarde.',
              sugiereReemplazo: false,
            },
            previa: [],
          },
        }));
        return;
      }
      setLecturas((m) => ({
        ...m,
        [slot]: {
          veredicto: veredictoLectura(slot, r.data),
          previa: vistaPreviaCampos(r.data.campos),
        },
      }));
      // Lo que salió de la lectura son los campos que la contraparte confirma
      // en el paso siguiente: sin recargar, ese paso seguiría diciendo que
      // todavía no hay nada leído.
      if (r.data.estado === 'ok') await recargar();
    } finally {
      setLeyendo(null);
    }
  }

  function subir(slot: string, file: File) {
    const err = validarArchivo(file);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSubiendo(slot);
    // El veredicto anterior describe el archivo anterior. Dejarlo puesto
    // mientras sube el nuevo es afirmar algo del archivo equivocado.
    setLecturas((m) => {
      const n = { ...m };
      delete n[slot];
      return n;
    });
    startTransition(async () => {
      let docId: string | null = null;
      try {
        const r = await pedirUrlDeSubida(token, {
          slot,
          mime: file.type,
          size: file.size,
        });
        if (!r.ok) {
          setError('No se pudo preparar la subida. Vuelve a intentar.');
          return;
        }
        // El binario va directo al almacenamiento con la URL firmada: no pasa
        // por nuestro servidor, así un archivo grande no choca contra el tope
        // de la función.
        const fd = new FormData();
        fd.append('cacheControl', '3600');
        fd.append('', file);
        const res = await fetch(r.data.uploadUrl, { method: 'PUT', body: fd });
        if (!res.ok) {
          setError('El archivo no se pudo subir. Revisa tu conexión y vuelve a intentar.');
          return;
        }
        docId = r.data.docId;
        await recargar();
      } finally {
        setSubiendo(null);
      }
      // Sin `await`: la transición cierra acá y el formulario queda usable
      // mientras el lector trabaja. La rueda de ESE bloque la lleva `leyendo`.
      if (docId) void leerAhora(slot, docId);
    });
  }

  function abrirFormSocio(padre: string | null, socio?: Socio) {
    setErroresSocio({});
    setPorRetirar(null);
    setSocioPadre(padre);
    setSocioEditado(socio?.persona_id ?? null);
    setFormSocio(
      socio
        ? {
            tipoSujeto: socio.tipo_sujeto,
            nombre: socio.nombre,
            documentoTipo: socio.documento_tipo ?? 'CC',
            documentoNumero: socio.documento_numero ?? '',
            porcentaje:
              socio.porcentaje_participacion === null
                ? ''
                : String(socio.porcentaje_participacion),
            motivoParada: socio.motivo_parada ?? '',
            justificacion: socio.parada_justificacion ?? '',
          }
        : FORM_SOCIO_VACIO,
    );
  }

  function cerrarFormSocio() {
    setFormSocio(null);
    setSocioEditado(null);
    setSocioPadre(null);
    setErroresSocio({});
  }

  function guardarSocioAhora() {
    if (!formSocio) return;
    const errores = faltaEnFormSocio(formSocio);
    setErroresSocio(errores);
    if (Object.keys(errores).length > 0) return;

    startTransition(async () => {
      setError(null);
      const r = await guardarSocio(token, {
        personaId: socioEditado,
        padrePersonaId: socioPadre,
        form: formSocio,
      });
      if (!r.ok) {
        setError('No se pudo guardar el socio. Revisa los datos y vuelve a intentar.');
        return;
      }
      cerrarFormSocio();
      // La respuesta ya trae la cadena recalculada; recargar además refresca en
      // qué paso va, que es lo único que no viene en esa respuesta.
      setV((prev) => ({ ...prev, socios: r.data.socios, cadena: r.data.cadena }));
      await recargar();
    });
  }

  function retirarSocioAhora(personaId: string) {
    startTransition(async () => {
      setError(null);
      const r = await retirarSocio(token, personaId);
      if (!r.ok) {
        setError('No se pudo retirar el socio. Vuelve a intentar.');
        return;
      }
      setPorRetirar(null);
      setV((prev) => ({ ...prev, socios: r.data.socios, cadena: r.data.cadena }));
      await recargar();
    });
  }

  /**
   * El soporte de un socio no pasa por el lector: es el certificado de otra
   * empresa y sus datos no son los del expediente. Por eso acá no hay veredicto
   * ni vista previa, solo la constancia de que llegó.
   */
  function subirSoporte(personaId: string, file: File) {
    const err = validarArchivo(file);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSubiendoSoporte(personaId);
    startTransition(async () => {
      try {
        const r = await pedirUrlDeSubida(token, {
          slot: SLOT_SOPORTE_BF,
          personaId,
          mime: file.type,
          size: file.size,
        });
        if (!r.ok) {
          setError('No se pudo preparar la subida. Vuelve a intentar.');
          return;
        }
        const fd = new FormData();
        fd.append('cacheControl', '3600');
        fd.append('', file);
        const res = await fetch(r.data.uploadUrl, { method: 'PUT', body: fd });
        if (!res.ok) {
          setError('El archivo no se pudo subir. Revisa tu conexión y vuelve a intentar.');
          return;
        }
        await recargar();
      } finally {
        setSubiendoSoporte(null);
      }
    });
  }

  function confirmarUno(slug: string) {
    startTransition(async () => {
      setError(null);
      const texto = borradores[slug];
      const r = await confirmarCampos(token, [
        texto === undefined ? { slug, confirmado: true } : { slug, value: texto, confirmado: true },
      ]);
      if (!r.ok) {
        setError('No se pudo guardar. Vuelve a intentar.');
        return;
      }
      await recargar();
    });
  }

  function pedirCodigo() {
    startTransition(async () => {
      setError(null);
      const r = await pedirCodigoDeFirma(token, {
        nombre: nombreFirmante,
        documento: docFirmante,
      });
      if (!r.ok) {
        setError(await traducirErrorFirma(r.error));
        return;
      }
      setEnviadoA(r.data.enviadoA);
      setOtp('');
    });
  }

  function firmar() {
    startTransition(async () => {
      setError(null);
      const r = await firmarConCodigo(token, otp);
      if (!r.ok) {
        setError(await traducirErrorFirma(r.error));
        return;
      }
      setOtp('');
      await recargar();
    });
  }

  const pasos = pasosVisibles(v.pideCadena);
  const pasoIdx = pasos.indexOf(v.paso);

  return (
    <main className="min-h-screen">
      {/* ── Quién te está pidiendo esto ── */}
      <header className="border-b border-[#E5E7EB] bg-white">
        <div className="max-w-2xl mx-auto px-6 py-5 flex items-center gap-4">
          {v.marca.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- dinámico desde Supabase storage, tamaño variable
            <img
              src={v.marca.logoUrl}
              alt={v.marca.nombre}
              className="h-12 w-auto max-w-[200px] object-contain"
              // Un logo roto en la pagina que ve un desconocido se lee peor que
              // no tener logo: se esconde y queda el nombre solo.
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div
              className="h-12 w-12 rounded-lg flex items-center justify-center text-white font-bold"
              style={{ background: acento }}
            >
              {v.marca.nombre.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#1A1A1A] truncate">{v.marca.nombre}</p>
            <p className="text-xs text-[#6B7280]">
              {[v.marca.nit ? `NIT ${v.marca.nit}` : null, v.marca.ciudad]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-xl font-bold text-[#1A1A1A]">
          {v.marca.nombre} necesita conocer a {quien}
        </h1>
        <p className="text-sm text-[#6B7280] mt-1.5">
          Es un trámite de una sola vez. Subes unos documentos, revisas los datos que el sistema
          lee de ellos y confirmas. No tienes que transcribir nada.
        </p>

        {/* ── En qué vas ── */}
        <div className="flex gap-1.5 mt-5 mb-6">
          {pasos.map((p, i) => (
            <div key={p} className="flex-1">
              <div
                className="h-1.5 rounded-full"
                style={{ background: i <= pasoIdx ? acento : '#E5E7EB' }}
              />
              <p
                className={`text-[11px] mt-1 ${i <= pasoIdx ? 'text-[#1A1A1A] font-semibold' : 'text-[#9CA3AF]'}`}
              >
                {PASO_LABEL[p as PasoPublico]}
              </p>
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/5 p-3 text-sm text-[#B91C1C]">
            {error}
          </div>
        )}

        {/* ── PASO 1: el portón ── */}
        {v.paso === 'aceptaciones' ? (
          <section>
            <div className="flex items-start gap-2 mb-4 text-sm text-[#4B5563]">
              <Lock className="w-4 h-4 mt-0.5 shrink-0 text-[#6B7280]" />
              <p>
                Antes de que subas cualquier documento necesitamos tu autorización. Léelas y
                acéptalas para continuar.
              </p>
            </div>

            <div className="space-y-3">
              {textos.map((t) => (
                <div key={t.tipo} className="rounded-lg border border-[#E5E7EB] bg-white">
                  <button
                    type="button"
                    onClick={() => setAbierto(abierto === t.tipo ? null : t.tipo)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <span className="text-sm font-semibold text-[#1A1A1A]">{t.titulo}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#9CA3AF] shrink-0 transition ${abierto === t.tipo ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {abierto === t.tipo && (
                    <div className="px-4 pb-3 space-y-2 border-t border-[#F3F4F6] pt-3">
                      {t.parrafos.map((p, i) => (
                        <p key={i} className="text-[13px] leading-relaxed text-[#4B5563]">
                          {p}
                        </p>
                      ))}
                    </div>
                  )}
                  <label className="flex items-start gap-2.5 px-4 py-3 border-t border-[#F3F4F6] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!marcadas[t.tipo]}
                      onChange={(ev) =>
                        setMarcadas((m) => ({ ...m, [t.tipo]: ev.target.checked }))
                      }
                      className="mt-0.5 w-4 h-4 shrink-0"
                    />
                    <span className="text-[13px] text-[#1A1A1A]">{t.casilla}</span>
                  </label>
                </div>
              ))}
            </div>

            <button
              type="button"
              disabled={!todasMarcadas || pending}
              onClick={aceptar}
              className="mt-5 w-full px-4 py-3 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
              style={{ background: acento }}
            >
              {pending ? 'Guardando...' : 'Acepto y continúo'}
            </button>
            <p className="text-[11px] text-[#9CA3AF] mt-2 text-center">
              Queda registrada la fecha y la versión exacta del texto que aceptaste.
            </p>
          </section>
        ) : (
          <>
            {/* ── PASO 2: documentos ── */}
            <section className="mb-8">
              <h2 className="text-base font-bold text-[#1A1A1A] mb-1">Documentos</h2>
              <p className="text-xs text-[#6B7280] mb-3">
                Arrastra cada archivo a su bloque, o usa el botón. PDF, JPG o PNG, hasta{' '}
                {TAMANO_MAX_MB} MB cada uno. Los leemos apenas los subas y te decimos acá mismo si
                el documento es el que se pidió.
              </p>
              <div className="space-y-2">
                {v.kit.map((s) => {
                  // Un bloque YA cargado también recibe. Si la persona subió el
                  // documento equivocado tiene que poder cambiarlo ahora, que es
                  // cuando lo tiene a la mano; obligarla a escribirle a alguien
                  // para que le abra el paso es el reproceso que este flujo
                  // existe para evitar. Lo único cerrado es el expediente ya
                  // firmado: ahí un documento nuevo entraría por debajo del hash
                  // que se selló.
                  const recibe = v.paso !== 'listo' && !pending && leyendo !== s.slot;
                  const nota = notaPedido(s.slot);
                  const l = lecturas[s.slot];
                  return (
                    <div
                      key={s.slot}
                      onDragOver={
                        recibe
                          ? (ev) => {
                              ev.preventDefault();
                              setEncima(s.slot);
                            }
                          : undefined
                      }
                      onDragLeave={recibe ? () => setEncima(null) : undefined}
                      onDrop={
                        recibe
                          ? (ev) => {
                              ev.preventDefault();
                              soltar(s.slot, ev.dataTransfer.files);
                            }
                          : undefined
                      }
                      className={`px-4 py-3 rounded-lg border bg-white transition ${
                        encima === s.slot
                          ? 'border-dashed border-2 border-[#1A1A1A] bg-[#F9FAFB]'
                          : 'border-[#E5E7EB]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-[#1A1A1A]">{nombrePedido(s.slot)}</p>
                          {nota && <p className="text-xs text-[#6B7280] mt-0.5">{nota}</p>}
                          {recibe && !s.cargado && (
                            <p className="text-xs text-[#9CA3AF] mt-0.5">
                              {encima === s.slot ? 'Suelta acá' : 'Arrástralo acá o usa el botón'}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {s.cargado && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#059669]">
                              <Check className="w-3.5 h-3.5" /> Recibido
                            </span>
                          )}
                          {v.paso === 'listo' ? (
                            !s.cargado && (
                              // Ya firmado: subir más documentos cambiaría el
                              // expediente por debajo del hash que se selló.
                              <span className="text-xs text-[#9CA3AF]">No se recibió</span>
                            )
                          ) : (
                            <>
                              <input
                                ref={(el) => {
                                  inputs.current[s.slot] = el;
                                }}
                                type="file"
                                accept="application/pdf,image/jpeg,image/png"
                                className="hidden"
                                onChange={(ev) => {
                                  const f = ev.target.files?.[0];
                                  if (f) subir(s.slot, f);
                                  ev.target.value = '';
                                }}
                              />
                              <button
                                type="button"
                                disabled={pending || leyendo === s.slot}
                                onClick={() => inputs.current[s.slot]?.click()}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-xs font-semibold text-[#4B5563] shrink-0 disabled:opacity-50"
                              >
                                {subiendo === s.slot ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : s.cargado ? (
                                  <RefreshCw className="w-3.5 h-3.5" />
                                ) : (
                                  <FileUp className="w-3.5 h-3.5" />
                                )}
                                {s.cargado ? 'Reemplazar' : 'Subir'}
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {leyendo === s.slot && (
                        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#6B7280]">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Leyendo el documento para confirmar que es el correcto...
                        </p>
                      )}

                      {l && leyendo !== s.slot && (
                        <div className="mt-2">
                          <p className={`text-xs ${TONO_LECTURA[l.veredicto.tono]}`}>
                            {l.veredicto.texto}
                          </p>
                          {l.previa.length > 0 && (
                            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                              {l.previa.map((c) => (
                                <li key={c.slug} className="text-[11px] text-[#6B7280]">
                                  <span className="text-[#9CA3AF]">
                                    {c.slug.replace(/_/g, ' ')}:
                                  </span>{' '}
                                  {c.texto}
                                </li>
                              ))}
                            </ul>
                          )}
                          {l.veredicto.sugiereReemplazo && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => inputs.current[s.slot]?.click()}
                              className="mt-1.5 text-xs font-semibold underline text-[#1A1A1A] disabled:opacity-50"
                            >
                              Subir otro archivo
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── PASO 3: socios ── */}
            {v.pideCadena && (
              <section>
                <h2 className="text-base font-bold text-[#1A1A1A] mb-1">Socios de {quien}</h2>
                <p className="text-xs text-[#6B7280] mb-2">{POR_QUE_LOS_SOCIOS}</p>
                <p className="text-sm text-[#4B5563] mb-3">{resumenCadena(v.cadena, v.socios)}</p>

                {v.socios.length > 0 && (
                  <div className="rounded-lg border border-[#E5E7EB] overflow-hidden mb-3">
                    {v.socios.map((soc, i) => {
                      const falta = faltasDe(v.cadena, soc.persona_id);
                      const esEmpresa = soc.tipo_sujeto === 'juridica';
                      const conParada = Boolean(soc.motivo_parada);
                      return (
                        <div
                          key={soc.persona_id}
                          className={`px-4 py-3 ${i > 0 ? 'border-t border-[#F3F4F6]' : ''}`}
                          style={{ paddingLeft: 16 + soc.nivel * 20 }}
                        >
                          <div className="flex items-center gap-2">
                            {esEmpresa ? (
                              <Building2 className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                            ) : (
                              <User className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                            )}
                            <p className="text-sm text-[#1A1A1A] min-w-0 flex-1 truncate">
                              {soc.nombre}
                              {soc.documento_numero && (
                                <span className="text-xs text-[#6B7280]">
                                  {' '}
                                  · {soc.documento_numero}
                                </span>
                              )}
                            </p>
                            <span className="text-xs text-[#4B5563] shrink-0">
                              {textoParticipacion(soc)}
                            </span>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => abrirFormSocio(soc.padre_persona_id, soc)}
                              className="text-xs underline text-[#4B5563] shrink-0 disabled:opacity-50"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => setPorRetirar(soc.persona_id)}
                              aria-label={`Retirar a ${soc.nombre}`}
                              className="text-[#9CA3AF] hover:text-[#B91C1C] shrink-0 disabled:opacity-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          {falta.map((f) => (
                            <p key={f} className="text-xs text-[#B45309] mt-1 pl-6">
                              {fraseFalta(f)}
                            </p>
                          ))}

                          {conParada && (
                            <p className="text-xs text-[#6B7280] mt-1 pl-6">
                              {MOTIVO_PARADA_LABEL[soc.motivo_parada as MotivoParada] ??
                                soc.motivo_parada}
                              {soc.parada_justificacion ? `: ${soc.parada_justificacion}` : ''}
                            </p>
                          )}

                          {esEmpresa && !conParada && (
                            <div className="mt-2 pl-6">
                              <p className="text-xs text-[#6B7280]">{notaSoporteBf(soc.nombre)}</p>
                              <input
                                ref={(el) => {
                                  inputsSoporte.current[soc.persona_id] = el;
                                }}
                                type="file"
                                accept="application/pdf,image/jpeg,image/png"
                                className="hidden"
                                onChange={(ev) => {
                                  const f = ev.target.files?.[0];
                                  if (f) subirSoporte(soc.persona_id, f);
                                  ev.target.value = '';
                                }}
                              />
                              <div className="flex items-center gap-3 mt-1.5">
                                <button
                                  type="button"
                                  disabled={pending || subiendoSoporte === soc.persona_id}
                                  onClick={() => inputsSoporte.current[soc.persona_id]?.click()}
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold underline text-[#1A1A1A] disabled:opacity-50"
                                >
                                  {subiendoSoporte === soc.persona_id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : soc.tiene_soporte ? (
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  ) : (
                                    <FileUp className="w-3.5 h-3.5" />
                                  )}
                                  {soc.tiene_soporte ? 'Cambiar el soporte' : 'Subir el soporte'}
                                </button>
                                {soc.tiene_soporte && (
                                  <span className="inline-flex items-center gap-1 text-xs text-[#059669]">
                                    <Check className="w-3.5 h-3.5" /> Recibido
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => abrirFormSocio(soc.persona_id)}
                                className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-[#1A1A1A] underline disabled:opacity-50"
                              >
                                <Plus className="w-3.5 h-3.5" /> Agregar socio de {soc.nombre}
                              </button>
                            </div>
                          )}

                          {porRetirar === soc.persona_id && (
                            <div className="mt-2 pl-6 flex items-center gap-3">
                              <p className="text-xs text-[#B91C1C]">
                                Se va {soc.nombre} y todo lo que cuelgue de él, con sus soportes.
                              </p>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => retirarSocioAhora(soc.persona_id)}
                                className="text-xs font-semibold underline text-[#B91C1C] disabled:opacity-50"
                              >
                                Retirar
                              </button>
                              <button
                                type="button"
                                onClick={() => setPorRetirar(null)}
                                className="text-xs underline text-[#6B7280]"
                              >
                                Dejarlo
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {formSocio === null ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => abrirFormSocio(null)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50"
                    style={{ background: acento }}
                  >
                    <Plus className="w-4 h-4" /> Agregar socio
                  </button>
                ) : (
                  <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
                    <p className="text-sm font-semibold text-[#1A1A1A] mb-3">
                      {socioEditado
                        ? 'Editar socio'
                        : socioPadre
                          ? `Socio de ${v.socios.find((x) => x.persona_id === socioPadre)?.nombre ?? 'la empresa'}`
                          : `Socio de ${quien}`}
                    </p>

                    <div className="flex gap-2 mb-3">
                      {(['natural', 'juridica'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() =>
                            setFormSocio((f) => (f ? { ...f, tipoSujeto: t } : f))
                          }
                          className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                            formSocio.tipoSujeto === t
                              ? 'border-[#1A1A1A] text-[#1A1A1A]'
                              : 'border-[#E5E7EB] text-[#6B7280]'
                          }`}
                        >
                          {t === 'natural' ? 'Es una persona' : 'Es una empresa'}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs text-[#6B7280] mb-1">
                          {formSocio.tipoSujeto === 'juridica' ? 'Razón social' : 'Nombre completo'}
                        </label>
                        <input
                          value={formSocio.nombre}
                          onChange={(ev) =>
                            setFormSocio((f) => (f ? { ...f, nombre: ev.target.value } : f))
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm"
                        />
                        {erroresSocio.nombre && (
                          <p className="text-xs text-[#B91C1C] mt-1">{erroresSocio.nombre}</p>
                        )}
                      </div>

                      <div className="flex gap-2">
                        {formSocio.tipoSujeto === 'natural' && (
                          <select
                            value={formSocio.documentoTipo}
                            onChange={(ev) =>
                              setFormSocio((f) =>
                                f ? { ...f, documentoTipo: ev.target.value } : f,
                              )
                            }
                            className="px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm"
                          >
                            <option value="CC">CC</option>
                            <option value="CE">CE</option>
                            <option value="PAS">Pasaporte</option>
                          </select>
                        )}
                        <input
                          value={formSocio.documentoNumero}
                          onChange={(ev) =>
                            setFormSocio((f) =>
                              f ? { ...f, documentoNumero: ev.target.value } : f,
                            )
                          }
                          placeholder={formSocio.tipoSujeto === 'juridica' ? 'NIT' : 'Número'}
                          className="flex-1 px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm"
                        />
                        <div className="w-28">
                          <input
                            value={formSocio.porcentaje}
                            onChange={(ev) =>
                              setFormSocio((f) => (f ? { ...f, porcentaje: ev.target.value } : f))
                            }
                            placeholder="% "
                            inputMode="decimal"
                            className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm"
                          />
                        </div>
                      </div>
                      {erroresSocio.porcentaje && (
                        <p className="text-xs text-[#B91C1C]">{erroresSocio.porcentaje}</p>
                      )}

                      {formSocio.tipoSujeto === 'juridica' && (
                        <div className="pt-1">
                          <label className="block text-xs text-[#6B7280] mb-1">
                            Si no se puede seguir bajando por esta empresa, dilo acá
                          </label>
                          <select
                            value={formSocio.motivoParada}
                            onChange={(ev) =>
                              setFormSocio((f) =>
                                f ? { ...f, motivoParada: ev.target.value } : f,
                              )
                            }
                            className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm"
                          >
                            <option value="">Sí se puede: voy a registrar sus socios</option>
                            {MOTIVOS_PARADA.map((m) => (
                              <option key={m} value={m}>
                                {MOTIVO_PARADA_LABEL[m]}
                              </option>
                            ))}
                          </select>
                          {formSocio.motivoParada && (
                            <>
                              <p className="text-xs text-[#6B7280] mt-1">
                                {MOTIVO_PARADA_AYUDA[formSocio.motivoParada as MotivoParada]}
                              </p>
                              <textarea
                                value={formSocio.justificacion}
                                onChange={(ev) =>
                                  setFormSocio((f) =>
                                    f ? { ...f, justificacion: ev.target.value } : f,
                                  )
                                }
                                rows={2}
                                className="w-full mt-1.5 px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm"
                              />
                              {erroresSocio.justificacion && (
                                <p className="text-xs text-[#B91C1C] mt-1">
                                  {erroresSocio.justificacion}
                                </p>
                              )}
                            </>
                          )}
                          {erroresSocio.motivoParada && (
                            <p className="text-xs text-[#B91C1C] mt-1">
                              {erroresSocio.motivoParada}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 mt-4">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={guardarSocioAhora}
                        className="px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50"
                        style={{ background: acento }}
                      >
                        {pending ? 'Guardando...' : 'Guardar'}
                      </button>
                      <button
                        type="button"
                        onClick={cerrarFormSocio}
                        className="px-4 py-2 rounded-lg border border-[#E5E7EB] text-sm text-[#4B5563]"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── PASO 4: datos ── */}
            <section>
              <h2 className="text-base font-bold text-[#1A1A1A] mb-1">Tus datos</h2>
              {v.campos.length === 0 ? (
                <p className="text-sm text-[#6B7280]">
                  Estamos leyendo tus documentos. Vuelve a este enlace más tarde y acá van a
                  aparecer los datos para que los revises.
                </p>
              ) : porConfirmar.length === 0 ? (
                <p className="text-sm text-[#6B7280]">
                  Ya confirmaste todos tus datos.
                </p>
              ) : (
                <>
                  <p className="text-xs text-[#6B7280] mb-3">
                    Esto es lo que leímos de tus documentos. Corrige lo que esté mal y confirma.
                  </p>
                  <div className="space-y-2">
                    {porConfirmar.map((c) => (
                      <div
                        key={c.slug}
                        className="px-4 py-3 rounded-lg border border-[#E5E7EB] bg-white"
                      >
                        <label className="block text-xs text-[#6B7280] mb-1">
                          {c.slug.replace(/_/g, ' ')}
                        </label>
                        <div className="flex gap-2">
                          <input
                            value={
                              borradores[c.slug] ??
                              (typeof c.value === 'string' ? c.value : String(c.value ?? ''))
                            }
                            onChange={(ev) =>
                              setBorradores((b) => ({ ...b, [c.slug]: ev.target.value }))
                            }
                            className="flex-1 px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm"
                          />
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => confirmarUno(c.slug)}
                            className="px-3 py-2 rounded-lg text-white text-xs font-semibold shrink-0 disabled:opacity-50"
                            style={{ background: acento }}
                          >
                            Confirmar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </>
        )}

        {/* ── PASO 5: firma ── */}
        {v.paso === 'firma' && (
          <section className="mt-8">
            <h2 className="text-base font-bold text-[#1A1A1A] mb-1">Firma</h2>
            <p className="text-xs text-[#6B7280] mb-3">
              Con la firma declaras que lo que entregaste es cierto. Te mandamos un código de{' '}
              {LARGO_OTP} dígitos al correo con el que te invitaron.
            </p>

            <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
              {!enviadoA ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-[#4B5563] mb-1">
                        Quién firma
                      </label>
                      <input
                        value={nombreFirmante}
                        onChange={(ev) => setNombreFirmante(ev.target.value)}
                        placeholder="Nombre completo"
                        className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#4B5563] mb-1">
                        Documento
                      </label>
                      <input
                        value={docFirmante}
                        onChange={(ev) => setDocFirmante(ev.target.value)}
                        placeholder="Cédula"
                        className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={pedirCodigo}
                    className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
                    style={{ background: acento }}
                  >
                    {pending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <PenLine className="w-4 h-4" />
                    )}
                    Enviarme el código
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-[#1A1A1A]">
                    Te mandamos el código a <strong>{enviadoA}</strong>.
                  </p>
                  <p className="text-xs text-[#6B7280] mt-1">
                    Si no llega en un par de minutos, revisa el correo no deseado.
                  </p>
                  <input
                    value={otp}
                    onChange={(ev) => setOtp(normalizarOtp(ev.target.value))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    className="mt-3 w-full px-3 py-3 rounded-lg border border-[#E5E7EB] text-center text-xl tracking-[0.5em] font-semibold"
                  />
                  <button
                    type="button"
                    disabled={pending || !otpCompleto(otp)}
                    onClick={firmar}
                    className="mt-3 w-full px-4 py-3 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
                    style={{ background: acento }}
                  >
                    {pending ? 'Firmando...' : 'Firmar'}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={pedirCodigo}
                    className="mt-2 w-full px-4 py-2 text-xs font-semibold text-[#6B7280] disabled:opacity-40"
                  >
                    Reenviar el código
                  </button>
                </>
              )}
            </div>
          </section>
        )}

        {/* ── Listo ── */}
        {v.paso === 'listo' && (
          <section className="mt-8">
            <div className="rounded-lg border border-[#10B981]/30 bg-[#ECFDF5] p-5">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-[#059669]">
                <ShieldCheck className="w-4 h-4" /> Firmaste. Ya está todo.
              </p>
              <p className="text-xs text-[#047857] mt-1.5">
                {v.marca.nombre} va a revisar tu expediente y te avisa. No tienes que hacer nada
                más.
              </p>
            </div>
          </section>
        )}

        <footer className="mt-10 pt-5 border-t border-[#E5E7EB]">
          <p className="text-[11px] text-[#9CA3AF]">
            Este enlace es personal. No lo reenvíes: quien lo tenga puede ver y modificar lo que
            entregaste.
          </p>
        </footer>
      </div>
    </main>
  );
}
