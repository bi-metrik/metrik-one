-- ============================================================================
-- SOENA · 2026-09-24
-- La titularidad (modalidad y titulares) en la tarjeta del negocio y en el Excel.
--
-- Brief: proyectos/soena/ve/2026-09-24_brief-max-titularidad-tarjeta-excel.md
-- Pedido por Deisy, aprobado por Mauricio.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────────
-- Solo CONFIGURACIÓN: agrega `campos_extra` a `workspaces.config_extra.negocio_card`
-- de SOENA. No crea tablas ni funciones y no toca negocio_bloques: ningún dato de
-- ningún negocio cambia. Las demás claves de `negocio_card` (vehículo, cédula,
-- radicado, factura, servicio, cita) se conservan: se escribe con jsonb_set sobre la
-- ruta `negocio_card.campos_extra`.
--
-- Un campo, «Titularidad» (Único / Copropiedad / Leasing), con dos líneas de detalle:
--   · el titular del RUT (`rut.razon_social`);
--   · el segundo titular (`rut_solicitante_2.razon_social`) SOLO si la modalidad es
--     copropiedad. Es la regla que evita mostrar el RUT 2 que sobró en un caso que se
--     corrigió a «único»: la lista no evalúa si el bloque le aplica al caso (sería una
--     consulta por negocio), así que la condición va declarada aquí.
-- En el Excel salen dos columnas al final: «Titularidad» y «Titulares».
--
-- ── Orden ────────────────────────────────────────────────────────────────────
-- ANTES del merge. Con el código viejo la clave `campos_extra` no la lee nadie: es
-- inerte hasta que el deploy llega.
-- ============================================================================

do $$
declare
  ws_soena constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  n        int;
  v_campos_extra jsonb := $campos_extra$
[
  {
    "label": "Titularidad",
    "source_bloque_slug": "titularidad",
    "field": "modalidad_solicitante",
    "etiquetas": { "unico": "Único", "copropiedad": "Copropiedad", "leasing": "Leasing" },
    "detalle_label": "Titulares",
    "detalle": [
      { "source_bloque_slug": "rut", "field": "razon_social" },
      {
        "source_bloque_slug": "rut_solicitante_2",
        "field": "razon_social",
        "solo_si": { "source_bloque_slug": "titularidad", "field": "modalidad_solicitante", "value": "copropiedad" }
      }
    ]
  }
]
$campos_extra$::jsonb;
begin
  -- La tarjeta config-driven tiene que existir: sin ella SOENA no pinta vehículo ni
  -- cédula, y crearla aquí a medias sería peor que abortar.
  if not exists (
    select 1 from workspaces
     where id = ws_soena and jsonb_typeof(config_extra->'negocio_card') = 'object'
  ) then
    raise exception 'SOENA no tiene config_extra.negocio_card: no se agrega campos_extra';
  end if;

  -- Los tres slugs que lee la configuración tienen que existir en el workspace.
  select count(distinct slug) into n
    from bloque_configs
   where workspace_id = ws_soena
     and slug in ('titularidad', 'rut', 'rut_solicitante_2');
  if n <> 3 then
    raise exception 'se esperaban los bloques titularidad, rut y rut_solicitante_2 y hay %', n;
  end if;

  update workspaces
     set config_extra = jsonb_set(config_extra, '{negocio_card,campos_extra}', v_campos_extra, true)
   where id = ws_soena;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 workspace SOENA y se actualizaron %', n; end if;

  -- Lo que quedó escrito es lo que se quiso escribir, y lo demás de la tarjeta sigue ahí.
  if (select config_extra->'negocio_card'->'campos_extra' from workspaces where id = ws_soena)
       is distinct from v_campos_extra then
    raise exception 'campos_extra no quedó como se esperaba';
  end if;
  if (select config_extra->'negocio_card'->>'cedula_bloque' from workspaces where id = ws_soena) is null then
    raise exception 'negocio_card perdió sus claves previas';
  end if;
end $$;
