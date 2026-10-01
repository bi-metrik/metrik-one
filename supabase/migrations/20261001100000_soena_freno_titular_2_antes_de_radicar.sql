-- ============================================================================
-- SOENA · línea GIT EV/HEV · 2026-10-01
-- Freno de titulares ANTES de radicar ante la UPME.
--
-- Brief: proyectos/soena/ve/2026-10-01_brief-max-freno-titulares-antes-de-radicar.md
-- Estilo de 20260928213000_soena_certificado_ubicacion.sql.
--
-- Solo CONFIGURACIÓN (lineas_negocio.config_extra.cruces de una línea). No toca
-- negocio_bloques: ningún dato de ningún negocio cambia.
--
-- ── Por qué ──────────────────────────────────────────────────────────────────
-- 24 casos abiertos de copropiedad tienen el certificado UPME a nombre de UNA persona.
-- Diagnóstico (solo lectura, 2026-10-01): en los 24 la titularidad de ONE decía «único»
-- cuando se radicó, y se corrigió a «copropiedad» DESPUÉS de que llegó el certificado
-- (entre el 19-ago y el 30-sep). 21 se radicaron antes de existir en ONE (migrados) y 3
-- desde ONE (V0076, V0298, V0465), los tres con «único» al salir de Cargue. En ninguno
-- ONE tenía bien la titularidad y se perdió al cargar en la UPME: el segundo titular se
-- perdió en la TITULARIDAD, no en el cargue.
--
-- La radicación ocurre en Cargue (orden 7: `radicado_de_certificacion`). Para EVITAR el
-- error hay que frenar ANTES de entrar a Cargue, al salir de Documentación (6), y otra
-- vez al salir de Cargue (7) por si la titularidad se corrigió estando ahí: así no se
-- paga la tarifa UPME (Pago UPME, 8) sobre una solicitud incompleta.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────────
-- (1) Cruce NUEVO `titular_2_completo_antes_de_radicar` (tipo `requeridos`, lo trae el PR
--     de esta migración): en copropiedad exige el nombre y el número de documento del
--     RUT del solicitante 2. Frena en 6 y 7; en las demás etapas solo avisa en la
--     tarjeta de datos clave.
-- (2) Los cruces que ya comparan la titularidad con la factura frenan también en Cargue:
--     `factura_compradores_vs_titularidad` (factura con 2 compradores y titularidad
--     «único», el error de los 24) y `rut2_entre_compradores`. Pasan de [6] a [6, 7].
--
-- ── Medido el 2026-10-01, solo lectura ───────────────────────────────────────
-- Casos abiertos en etapas 1-7: 105 (14 en Validación, 83 en Propuesta, 1 en
-- Negociación, 7 en Documentación, 0 en Cargue).
--   (1) Hoy no frena a nadie: ninguna copropiedad está en 6 ni en 7. Frenará a V0482
--       (Propuesta, copropiedad, sin RUT 2) si llega a Documentación sin cargarlo.
--   (2) Hoy frena a V0508 (Documentación, factura con 2 compradores, titularidad
--       «único»), que YA estaba frenado por el mismo cruce en 6. Frenará en 6 y 7 a
--       V0495, V0535 y V0543 (Propuesta, mismo caso) si no se corrige la titularidad.
--   Ningún caso sano queda frenado.
--
-- ⚠️ Lo que NO se cruza (no hay de dónde leerlo): la evidencia de lo radicado. ONE solo
-- guarda el número de radicado y un pantallazo del panel de la UPME, del que se extrae
-- ese número; no hay documento ni campo con las personas cargadas en la plataforma.
--
-- ── Orden ────────────────────────────────────────────────────────────────────
-- (1) es inerte con el código viejo: descarta un cruce con un tipo que no conoce.
-- (2) frena en cuanto se aplica. Se puede aplicar antes o después del merge.
-- Re-aplicable.
-- ============================================================================

do $$
declare
  ws_soena   constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  linea_ve   constant uuid := '34a0fa6b-9ed3-4652-a419-42601132d1a8';
  n          int;
  v_cruce jsonb := $cruce_titular_2$
{
  "slug": "titular_2_completo_antes_de_radicar",
  "tipo": "requeridos",
  "mensaje": "La titularidad es copropiedad y falta {faltantes}. Sin las dos personas la UPME emite el certificado a una sola y hay que radicar y pagar otra vez. Carga el RUT del segundo titular en Documentación o, si el vehículo es de una sola persona, corrige la titularidad en Propuesta.",
  "condition": { "field": "modalidad_solicitante", "value": "copropiedad", "source_bloque_slug": "titularidad" },
  "campos": [
    { "source_bloque_slug": "rut_solicitante_2", "field": "razon_social", "label": "el nombre del segundo titular (RUT del solicitante 2)" },
    { "source_bloque_slug": "rut_solicitante_2", "field": "numero_identificacion", "label": "el número de documento del segundo titular (RUT del solicitante 2)" }
  ],
  "bloquea_en_etapas": [6, 7]
}
$cruce_titular_2$::jsonb;
begin
  -- Los cruces de titularidad de 20260924190000 tienen que estar: este frente va encima.
  if (select count(*) from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
       where l.id = linea_ve and l.workspace_id = ws_soena
         and c->>'slug' in ('factura_compradores_vs_titularidad', 'rut2_entre_compradores')) <> 2 then
    raise exception 'faltan los cruces de titularidad de 20260924190000: aplicar esa migración antes';
  end if;

  -- (2) Los dos existentes frenan en 6 y 7, conservando cualquier otra etapa que ya
  -- tuvieran. (1) El cruce nuevo, al final, solo si no está.
  update lineas_negocio l
     set config_extra = jsonb_set(
           l.config_extra,
           '{cruces}',
           (select jsonb_agg(
                     case when c->>'slug' in ('factura_compradores_vs_titularidad', 'rut2_entre_compradores')
                          then jsonb_set(c, '{bloquea_en_etapas}', (
                                 select jsonb_agg(x.e order by x.e)
                                   from (select distinct e::int as e
                                           from jsonb_array_elements_text(
                                                  coalesce(c->'bloquea_en_etapas', '[]'::jsonb) || '[6, 7]'::jsonb) as t2(e)) x))
                          else c end
                     order by ord)
              from jsonb_array_elements(l.config_extra->'cruces') with ordinality as t(c, ord))
           || case when exists (select 1 from jsonb_array_elements(l.config_extra->'cruces') x
                                 where x->>'slug' = v_cruce->>'slug')
                   then '[]'::jsonb else jsonb_build_array(v_cruce) end
         )
   where l.id = linea_ve and l.workspace_id = ws_soena
     and jsonb_typeof(l.config_extra->'cruces') = 'array';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 línea GIT EV/HEV con cruces y se actualizaron %', n; end if;

  -- Verificaciones.
  if (select count(*) from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
       where l.id = linea_ve and c->>'slug' = v_cruce->>'slug') <> 1 then
    raise exception 'el cruce % no quedó exactamente una vez', v_cruce->>'slug';
  end if;
  if (select count(*) from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
       where l.id = linea_ve
         and c->>'slug' in ('factura_compradores_vs_titularidad', 'rut2_entre_compradores')
         and c->'bloquea_en_etapas' @> '[6, 7]'::jsonb) <> 2 then
    raise exception 'los cruces de factura contra titularidad no quedaron frenando en 6 y 7';
  end if;
  -- No se perdió ningún cruce de los que había.
  if (select count(*) from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
       where l.id = linea_ve
         and c->>'slug' in ('certificado_personas_vs_titularidad', 'certificado_correo_titular',
                            'certificado_direccion_titular_2')) <> 3 then
    raise exception 'la lista de cruces perdió entradas';
  end if;
end $$;
