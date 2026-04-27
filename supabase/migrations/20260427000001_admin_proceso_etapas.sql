-- admin_proceso_etapas: mapa del proceso interno MéTRIK Clarity.
-- Solo accesible desde workspace metrik (ADMIN_WORKSPACE_ID).
-- Los skills leen esta tabla via MCP para conocer su contrato (inputs/outputs/gates).

-- ─── Tabla ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_proceso_etapas (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  linea          TEXT    NOT NULL DEFAULT 'clarity',
  fase           TEXT    NOT NULL,                          -- 'venta' | 'ejecucion' | 'cobro'
  nombre         TEXT    NOT NULL,
  slug           TEXT    NOT NULL UNIQUE,                   -- 'negocio', 'diagnostico', ...
  orden          INT     NOT NULL,
  skill_name     TEXT,                                      -- null si skill no existe aún
  skill_estado   TEXT    NOT NULL DEFAULT 'pendiente',      -- 'pendiente' | 'en_construccion' | 'listo'
  descripcion    TEXT,
  inputs         JSONB   NOT NULL DEFAULT '[]'::JSONB,      -- [{nombre, tipo, fuente, requerido}]
  outputs        JSONB   NOT NULL DEFAULT '[]'::JSONB,      -- [{nombre, tipo, destino}]
  gates_entrada  JSONB   NOT NULL DEFAULT '[]'::JSONB,      -- [{condicion, descripcion}]
  bloques        JSONB   NOT NULL DEFAULT '[]'::JSONB,      -- [{nombre, tipo, descripcion}]
  paralelo_con   TEXT[],                                    -- slugs de etapas que corren en paralelo
  notas          TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_proceso_linea  ON public.admin_proceso_etapas(linea);
CREATE INDEX IF NOT EXISTS idx_admin_proceso_fase   ON public.admin_proceso_etapas(fase);
CREATE INDEX IF NOT EXISTS idx_admin_proceso_orden  ON public.admin_proceso_etapas(orden);

COMMENT ON TABLE  public.admin_proceso_etapas IS 'Definición del proceso interno MéTRIK. Readable por skills via MCP para conocer su contrato de inputs/outputs.';
COMMENT ON COLUMN public.admin_proceso_etapas.bloques IS 'Estructura de bloques que componen la etapa. Los skills leen esto para saber qué producir.';

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.admin_proceso_etapas_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_admin_proceso_etapas_updated_at ON public.admin_proceso_etapas;
CREATE TRIGGER trg_admin_proceso_etapas_updated_at
  BEFORE UPDATE ON public.admin_proceso_etapas
  FOR EACH ROW EXECUTE FUNCTION public.admin_proceso_etapas_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.admin_proceso_etapas ENABLE ROW LEVEL SECURITY;
-- Sin policies: solo service role accede (patron admin/workflows y admin/mibolsillo).

-- ─── Seed — Proceso Clarity ──────────────────────────────────────────────────
INSERT INTO public.admin_proceso_etapas
  (linea, fase, nombre, slug, orden, skill_name, skill_estado, descripcion, inputs, outputs, gates_entrada, bloques, paralelo_con, notas)
VALUES

-- ── FASE: VENTA ──────────────────────────────────────────────────────────────

('clarity', 'venta', 'Negocio', 'negocio', 1, 'negocio', 'listo',
 'Abre la oportunidad comercial. Registra el prospecto en ONE, crea la estructura local y Drive, inicializa el pipeline.json.',
 '[
   {"nombre": "contacto",         "tipo": "texto",   "fuente": "usuario",       "requerido": true},
   {"nombre": "cargo",            "tipo": "texto",   "fuente": "usuario",       "requerido": true},
   {"nombre": "empresa",          "tipo": "texto",   "fuente": "usuario",       "requerido": true},
   {"nombre": "industria",        "tipo": "texto",   "fuente": "usuario",       "requerido": true},
   {"nombre": "descripcion",      "tipo": "texto",   "fuente": "usuario",       "requerido": true},
   {"nombre": "valor_estimado",   "tipo": "numero",  "fuente": "usuario",       "requerido": true},
   {"nombre": "linea_negocio",    "tipo": "enum",    "fuente": "usuario",       "requerido": true}
 ]'::JSONB,
 '[
   {"nombre": "negocio_id",       "tipo": "uuid",    "destino": "ONE Supabase"},
   {"nombre": "pipeline.json",    "tipo": "archivo", "destino": "proyectos/{slug}/clarity/"},
   {"nombre": "CONTEXT.md",       "tipo": "archivo", "destino": "proyectos/{slug}/ (cliente + proyecto)"},
   {"nombre": "carpeta_drive",    "tipo": "ruta",    "destino": "gdrive:MéTRIK/Proyectos/{Empresa} — Clarity"}
 ]'::JSONB,
 '[]'::JSONB,
 '[
   {"nombre": "Datos del prospecto",     "tipo": "recopilacion",  "descripcion": "5 campos obligatorios: contacto, empresa, industria, problema, valor"},
   {"nombre": "Selección de línea",      "tipo": "decision",      "descripcion": "Clarity / Projects / Analytics / ONE"},
   {"nombre": "Verificación de slug",    "tipo": "validacion",    "descripcion": "Confirmar que el cliente no existe ya en proyectos/"},
   {"nombre": "Confirmación humana",     "tipo": "aprobacion",    "descripcion": "Resumen completo antes de crear. Gate obligatorio."},
   {"nombre": "Creación en ONE",         "tipo": "efecto",        "descripcion": "INSERT en negocios con etapa prospecto. Retorna negocio_id."},
   {"nombre": "Estructura local",        "tipo": "efecto",        "descripcion": "mkdir docs/entrada + docs/entrega + CONTEXT.md ×2"},
   {"nombre": "Carpeta Drive",           "tipo": "efecto",        "descripcion": "rclone mkdir gdrive:MéTRIK/Proyectos/{Empresa} — Clarity"},
   {"nombre": "pipeline.json",           "tipo": "efecto",        "descripcion": "Inicializar con 10 etapas Clarity (negocio completado, resto pendiente)"}
 ]'::JSONB,
 NULL,
 'Única etapa sin gate de entrada. Es el punto de origen de cualquier proceso Clarity.'),

('clarity', 'venta', 'Diagnóstico', 'diagnostico', 2, 'diagnostico', 'en_construccion',
 'Prepara la llamada pre-diagnóstico de 30 minutos. Genera agenda personalizada con las 10 preguntas adaptadas al sector y dolor conocido.',
 '[
   {"nombre": "pipeline.json",    "tipo": "archivo", "fuente": "proyectos/{slug}/clarity/", "requerido": true},
   {"nombre": "CONTEXT.md",       "tipo": "archivo", "fuente": "proyectos/{slug}/clarity/", "requerido": true},
   {"nombre": "info_adicional",   "tipo": "texto",   "fuente": "usuario (opcional)",        "requerido": false}
 ]'::JSONB,
 '[
   {"nombre": "agenda-diagnostico.md", "tipo": "archivo", "destino": "proyectos/{slug}/clarity/docs/entrada/"},
   {"nombre": "pipeline.json",         "tipo": "archivo", "destino": "diagnostico → completado, etapa_actual → radiografia"}
 ]'::JSONB,
 '[
   {"condicion": "pipeline.etapas.negocio.estado = completado", "descripcion": "No puede iniciarse sin el negocio abierto en ONE"}
 ]'::JSONB,
 '[
   {"nombre": "Lectura de pipeline",        "tipo": "lectura",      "descripcion": "Lee pipeline.json y CONTEXT.md del cliente"},
   {"nombre": "Carga de reglas",            "tipo": "lectura",      "descripcion": "Lee proceso-llamada-pre-diagnostico.md del cerebro"},
   {"nombre": "Información adicional",      "tipo": "recopilacion", "descripcion": "Pregunta a Mauricio si hay LinkedIn, noticias, cómo llegaron"},
   {"nombre": "Agenda personalizada",       "tipo": "generacion",   "descripcion": "10 preguntas adaptadas al sector/dolor + señales verde/amarillo/rojo"},
   {"nombre": "Confirmación humana",        "tipo": "aprobacion",   "descripcion": "Mauricio revisa la agenda antes de guardar"},
   {"nombre": "Guardar agenda",             "tipo": "efecto",       "descripcion": "Escribe docs/entrada/agenda-diagnostico.md"},
   {"nombre": "Actualizar pipeline",        "tipo": "efecto",       "descripcion": "diagnostico → completado, etapa_actual → radiografia"}
 ]'::JSONB,
 NULL,
 'El skill produce la agenda (pre-call). Post-call: Mauricio sube la grabación y corre /radiografia.'),

('clarity', 'venta', 'Radiografía', 'radiografia', 3, 'radiografia', 'listo',
 'Procesa la grabación de la llamada. Genera documento técnico/estratégico con ROI, payback, evaluación directiva y señal de calificación.',
 '[
   {"nombre": "grabacion_o_notas", "tipo": "texto/archivo", "fuente": "usuario",                    "requerido": true},
   {"nombre": "pipeline.json",     "tipo": "archivo",       "fuente": "proyectos/{slug}/clarity/",  "requerido": true}
 ]'::JSONB,
 '[
   {"nombre": "radiografia-{slug}.md",   "tipo": "archivo", "destino": "proyectos/{slug}/clarity/docs/entrega/"},
   {"nombre": "radiografia-{slug}.docx", "tipo": "archivo", "destino": "proyectos/{slug}/clarity/docs/entrega/"}
 ]'::JSONB,
 '[
   {"condicion": "grabacion o transcripcion disponible",       "descripcion": "Sin grabación no se puede procesar"},
   {"condicion": "pipeline.etapas.diagnostico.estado = completado", "descripcion": "La llamada ya ocurrió"}
 ]'::JSONB,
 '[
   {"nombre": "Identificación del cliente",   "tipo": "lectura",     "descripcion": "Lee pipeline.json y CONTEXT.md"},
   {"nombre": "Carga de reglas",              "tipo": "lectura",     "descripcion": "filtro-payback, 4-preguntas-financieras, pricing, framework-rev"},
   {"nombre": "Clasificación del prospecto",  "tipo": "analisis",    "descripcion": "Dolor → línea Clarity, madurez de datos, tamaño empresa, fit ICP"},
   {"nombre": "Cálculo ROI y payback",        "tipo": "calculo",     "descripcion": "ROI estimado + filtro payback (≤6m ideal, 6-12 estándar, 12-18 evaluar, >18 no)"},
   {"nombre": "Evaluación directiva",         "tipo": "evaluacion",  "descripcion": "Vera (operativa) + Santiago (comercial) + Carmen (financiero). Veto si payback >18m."},
   {"nombre": "Generación documento",         "tipo": "generacion",  "descripcion": "10 secciones: perfil, situación, dolores, ROI, módulos, directores, ICP, comercial, siguiente paso"},
   {"nombre": "Confirmación humana",          "tipo": "aprobacion",  "descripcion": "Mauricio revisa dolor + ROI + evaluación directiva + siguiente paso"},
   {"nombre": "Generar DOCX",                 "tipo": "efecto",      "descripcion": "pandoc + branding Montserrat + paleta oficial"}
 ]'::JSONB,
 ARRAY['presentacion'],
 'Sale en paralelo con Presentación. Si fit = Rojo, no proceder a propuesta.'),

('clarity', 'venta', 'Presentación', 'presentacion', 4, 'propuesta', 'listo',
 'Genera la propuesta comercial DOCX desde la radiografía. Documento orientado al cliente con precio, flujos propuestos y siguiente paso.',
 '[
   {"nombre": "radiografia-{slug}.md", "tipo": "archivo", "fuente": "proyectos/{slug}/clarity/docs/entrega/", "requerido": true},
   {"nombre": "pipeline.json",         "tipo": "archivo", "fuente": "proyectos/{slug}/clarity/",              "requerido": true}
 ]'::JSONB,
 '[
   {"nombre": "propuesta-{slug}.md",   "tipo": "archivo", "destino": "proyectos/{slug}/clarity/docs/entrega/"},
   {"nombre": "propuesta-{slug}.docx", "tipo": "archivo", "destino": "proyectos/{slug}/clarity/docs/entrega/"}
 ]'::JSONB,
 '[
   {"condicion": "radiografia completada",         "descripcion": "La propuesta comercial se basa en la radiografía"},
   {"condicion": "fit ICP ≠ rojo",                 "descripcion": "Carmen/directores vetaron continuar si payback >18m"}
 ]'::JSONB,
 '[
   {"nombre": "Carga radiografía",         "tipo": "lectura",   "descripcion": "Lee radiografía generada y extrae dolor, ROI, módulos propuestos"},
   {"nombre": "Carga pricing",             "tipo": "lectura",   "descripcion": "pricing-clarity.md — nunca de memoria"},
   {"nombre": "Estructura propuesta",      "tipo": "generacion","descripcion": "Portada, resumen ejecutivo, flujos propuestos, inversión, siguiente paso"},
   {"nombre": "Confirmación humana",       "tipo": "aprobacion","descripcion": "Mauricio revisa precio y alcance antes de generar DOCX"},
   {"nombre": "Generar DOCX",              "tipo": "efecto",    "descripcion": "pandoc + branding oficial. Sin trayectoria de Mauricio como credencial."}
 ]'::JSONB,
 ARRAY['radiografia'],
 'Skill existente: /propuesta. Corre en paralelo con radiografía. El nombre comercial en el proceso es "Presentación".'),

('clarity', 'venta', 'Contrato', 'contrato', 5, 'contrato', 'listo',
 'Genera el contrato integral desde la proforma [06E], lo revisa con Emilio y produce el documento final listo para firma.',
 '[
   {"nombre": "propuesta aprobada",     "tipo": "referencia", "fuente": "docs/entrega/",   "requerido": true},
   {"nombre": "datos legales cliente",  "tipo": "texto",      "fuente": "usuario",          "requerido": true}
 ]'::JSONB,
 '[
   {"nombre": "contrato-{slug}.docx",   "tipo": "archivo", "destino": "proyectos/{slug}/clarity/docs/entrega/"},
   {"nombre": "pipeline.json",          "tipo": "archivo", "destino": "contrato → completado, etapa_actual → setup"}
 ]'::JSONB,
 '[
   {"condicion": "propuesta enviada y aceptada verbalmente", "descripcion": "No se genera contrato sin interés confirmado"},
   {"condicion": "veto Emilio resuelto si sector regulado",  "descripcion": "Emilio revisa antes de firmar si hay compliance especial"}
 ]'::JSONB,
 '[
   {"nombre": "Carga proforma",          "tipo": "lectura",   "descripcion": "Lee proforma-contrato-integral.md del cerebro"},
   {"nombre": "Datos legales",           "tipo": "recopilacion","descripcion": "NIT, razón social, representante legal, domicilio"},
   {"nombre": "Revisión Emilio",         "tipo": "evaluacion", "descripcion": "CLO valida cláusulas críticas — veto legal absoluto"},
   {"nombre": "Confirmación humana",     "tipo": "aprobacion", "descripcion": "Mauricio aprueba antes de generar DOCX final"},
   {"nombre": "Generar DOCX",            "tipo": "efecto",     "descripcion": "Contrato listo para firmar"}
 ]'::JSONB,
 NULL,
 'Cierra la fase de Venta. Post-firma el proceso pasa a Ejecución.'),

-- ── FASE: EJECUCION ────────────────────────────────────────────────────────

('clarity', 'ejecucion', 'Setup', 'setup', 6, NULL, 'pendiente',
 'Parametrización del proceso de negocio CON EL CLIENTE. Define qué flujos se van a automatizar, quiénes son los actores, cuáles son las reglas de negocio.',
 '[
   {"nombre": "contrato firmado",     "tipo": "referencia", "fuente": "docs/entrega/",  "requerido": true},
   {"nombre": "pipeline.json",        "tipo": "archivo",    "fuente": "proyectos/{slug}/clarity/", "requerido": true}
 ]'::JSONB,
 '[
   {"nombre": "brief-setup.md",       "tipo": "archivo", "destino": "proyectos/{slug}/clarity/docs/entrada/"},
   {"nombre": "pipeline.json",        "tipo": "archivo", "destino": "setup → completado, etapa_actual → proceso"}
 ]'::JSONB,
 '[
   {"condicion": "contrato firmado",  "descripcion": "Solo se configura el proceso una vez hay compromiso legal"}
 ]'::JSONB,
 '[
   {"nombre": "Sesión con el cliente",  "tipo": "sesion",       "descripcion": "Reunión de 1-2h para mapear el proceso AS-IS"},
   {"nombre": "Inventario de actores",  "tipo": "recopilacion", "descripcion": "Quién hace qué, en qué sistema, con qué frecuencia"},
   {"nombre": "Reglas de negocio",      "tipo": "recopilacion", "descripcion": "Condiciones, excepciones, aprobaciones, umbrales"},
   {"nombre": "Puntos de dolor",        "tipo": "analisis",     "descripcion": "Dónde están los cuellos de botella y el desperdicio"},
   {"nombre": "Brief técnico",          "tipo": "efecto",       "descripcion": "Documento brief-setup.md como input para /proceso y /workspace"}
 ]'::JSONB,
 NULL,
 'Con el cliente = Mauricio + cliente reunidos. Output es el brief que alimenta a Proceso y Workspace.'),

('clarity', 'ejecucion', 'Proceso', 'proceso', 7, NULL, 'pendiente',
 'Documenta el proceso TO-BE usando Hana. Diseña la optimización del flujo basada en el AS-IS del Setup.',
 '[
   {"nombre": "brief-setup.md",   "tipo": "archivo", "fuente": "proyectos/{slug}/clarity/docs/entrada/", "requerido": true},
   {"nombre": "pipeline.json",    "tipo": "archivo", "fuente": "proyectos/{slug}/clarity/",              "requerido": true}
 ]'::JSONB,
 '[
   {"nombre": "proceso-{slug}.md",   "tipo": "archivo", "destino": "proyectos/{slug}/clarity/docs/entrega/"},
   {"nombre": "pipeline.json",       "tipo": "archivo", "destino": "proceso → completado, etapa_actual → workflow"}
 ]'::JSONB,
 '[
   {"condicion": "brief-setup.md disponible", "descripcion": "El proceso se diseña sobre el AS-IS documentado en Setup"}
 ]'::JSONB,
 '[
   {"nombre": "Carga del brief",          "tipo": "lectura",   "descripcion": "Lee brief-setup.md con el AS-IS del cliente"},
   {"nombre": "Análisis con Hana",        "tipo": "analisis",  "descripcion": "Aplicar 5 principios Lean: eliminar, combinar, simplificar, automatizar, estandarizar"},
   {"nombre": "Diseño TO-BE",             "tipo": "generacion","descripcion": "Proceso optimizado con actores, pasos, herramientas, reglas"},
   {"nombre": "Confirmación humana",      "tipo": "aprobacion","descripcion": "Mauricio (+ Vera) aprueba el diseño TO-BE"},
   {"nombre": "Documentar proceso",       "tipo": "efecto",    "descripcion": "Genera proceso-{slug}.md como input para /workflow"}
 ]'::JSONB,
 NULL,
 'Agente ejecutor: /hana (diseño) + /vera (validación entregabilidad). Output alimenta /workflow.'),

('clarity', 'ejecucion', 'Workflow', 'workflow', 8, 'workflow', 'listo',
 'Genera el diagrama HTML del flujo optimizado y lo publica en la biblioteca admin de ONE.',
 '[
   {"nombre": "proceso-{slug}.md", "tipo": "archivo", "fuente": "proyectos/{slug}/clarity/docs/entrega/", "requerido": true},
   {"nombre": "pipeline.json",     "tipo": "archivo", "fuente": "proyectos/{slug}/clarity/",              "requerido": true}
 ]'::JSONB,
 '[
   {"nombre": "workflow HTML",     "tipo": "archivo", "destino": "proyectos/{slug}/clarity/docs/entrega/"},
   {"nombre": "admin_workflows",   "tipo": "registro","destino": "Supabase — biblioteca admin ONE"},
   {"nombre": "pipeline.json",     "tipo": "archivo", "destino": "workflow → completado, etapa_actual → workspace"}
 ]'::JSONB,
 '[
   {"condicion": "proceso-{slug}.md disponible", "descripcion": "El workflow se genera desde el proceso documentado"}
 ]'::JSONB,
 '[
   {"nombre": "Carga proceso",           "tipo": "lectura",   "descripcion": "Lee proceso-{slug}.md con el TO-BE"},
   {"nombre": "Generación HTML",         "tipo": "generacion","descripcion": "Diagrama visual con bloques, actores, fases, condicionales"},
   {"nombre": "Confirmación humana",     "tipo": "aprobacion","descripcion": "Mauricio aprueba el diagrama antes de publicar"},
   {"nombre": "Publicar en ONE",         "tipo": "efecto",    "descripcion": "sync_to_one.js upserta a admin_workflows en Supabase"},
   {"nombre": "Actualizar pipeline",     "tipo": "efecto",    "descripcion": "workflow → completado"}
 ]'::JSONB,
 NULL,
 NULL),

('clarity', 'ejecucion', 'Workspace', 'workspace', 9, NULL, 'pendiente',
 'Configuración técnica del workspace ONE CON CLAUDE. Etapas, campos custom, gates, tableros. Transforma el diseño del proceso en infraestructura ONE operativa.',
 '[
   {"nombre": "brief-setup.md",        "tipo": "archivo", "fuente": "proyectos/{slug}/clarity/docs/entrada/", "requerido": true},
   {"nombre": "proceso-{slug}.md",     "tipo": "archivo", "fuente": "proyectos/{slug}/clarity/docs/entrega/", "requerido": true},
   {"nombre": "pipeline.json",         "tipo": "archivo", "fuente": "proyectos/{slug}/clarity/",              "requerido": true}
 ]'::JSONB,
 '[
   {"nombre": "workspace configurado", "tipo": "estado",   "destino": "ONE — etapas + campos + gates + tableros activos"},
   {"nombre": "pipeline.json",         "tipo": "archivo",  "destino": "workspace → completado, etapa_actual → adopcion"}
 ]'::JSONB,
 '[
   {"condicion": "workflow completado",     "descripcion": "La configuración técnica sigue al diseño validado"},
   {"condicion": "brief-setup.md listo",   "descripcion": "Necesita las reglas de negocio documentadas en Setup"}
 ]'::JSONB,
 '[
   {"nombre": "Configure workflow",     "tipo": "efecto",    "descripcion": "/configure-workflow {slug} — etapas custom + reglas de transición"},
   {"nombre": "Configure fields",       "tipo": "efecto",    "descripcion": "/configure-fields {slug} — campos custom + herencia entre entidades"},
   {"nombre": "Configure gates",        "tipo": "efecto",    "descripcion": "/configure-gates {slug} — condiciones de avance por etapa"},
   {"nombre": "Configure tableros",     "tipo": "efecto",    "descripcion": "Activar tabs relevantes en workspace_modules"},
   {"nombre": "QA técnico",             "tipo": "validacion","descripcion": "Probar el flujo completo en el workspace antes de entregar al cliente"}
 ]'::JSONB,
 NULL,
 'Con Claude = Mauricio + Claude sin el cliente. Usa los 3 skills /configure-*. Output: workspace ONE listo para el cliente.'),

('clarity', 'ejecucion', 'Adopción', 'adopcion', 10, NULL, 'pendiente',
 'Onboarding del cliente en ONE. Capacitación, ajustes, estabilización del uso.',
 '[
   {"nombre": "workspace configurado y probado", "tipo": "estado",    "fuente": "ONE",                "requerido": true},
   {"nombre": "pipeline.json",                   "tipo": "archivo",   "fuente": "proyectos/{slug}/clarity/", "requerido": true}
 ]'::JSONB,
 '[
   {"nombre": "cliente activo en ONE",    "tipo": "estado",   "destino": "ONE — workspace con uso real"},
   {"nombre": "pipeline.json",            "tipo": "archivo",  "destino": "adopcion → completado, proceso → completado (Clarity)"}
 ]'::JSONB,
 '[
   {"condicion": "workspace completado y QA pasado", "descripcion": "No se puede hacer onboarding de un workspace sin probar"}
 ]'::JSONB,
 '[
   {"nombre": "Sesión de onboarding",      "tipo": "sesion",      "descripcion": "Demo guiada con el cliente en su workspace real"},
   {"nombre": "Capacitación equipo",       "tipo": "sesion",      "descripcion": "Story Mode + flujos específicos del cliente"},
   {"nombre": "Período de estabilización", "tipo": "seguimiento", "descripcion": "2-3 semanas de soporte activo. Sofia lidera."},
   {"nombre": "Handoff a Success",         "tipo": "efecto",      "descripcion": "Traspaso a Sofia para seguimiento continuo"}
 ]'::JSONB,
 NULL,
 'Agente ejecutor: /sofia (Customer Success). Marca el cierre de la fase de Ejecución Clarity.');
