'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  Check,
  ChevronDown,
  FileUp,
  Loader2,
  Lock,
  PenLine,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  abrirVinculacion,
  aceptarCondiciones,
  confirmarCampos,
  firmarConCodigo,
  pedirCodigoDeFirma,
  leerDocumento,
  pedirUrlDeSubida,
  traducirErrorFirma,
  type VistaPublica,
} from '@/lib/actions/vinculacion-publica';
import {
  LARGO_OTP,
  PASOS,
  PASO_LABEL,
  TAMANO_MAX_MB,
  nombrePedido,
  normalizarOtp,
  notaPedido,
  veredictoLectura,
  vistaPreviaCampos,
  otpCompleto,
  textosAceptacion,
  archivoSoltado,
  validarArchivo,
  type PasoPublico,
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

  const pasoIdx = PASOS.indexOf(v.paso);

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
          {PASOS.map((p, i) => (
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

            {/* ── PASO 3: datos ── */}
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

        {/* ── PASO 4: firma ── */}
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
