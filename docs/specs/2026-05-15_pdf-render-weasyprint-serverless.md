# Spec: PDF Render Serverless con WeasyPrint

**Fecha:** 2026-05-15
**Owner tecnico:** Max
**Driver:** Mauricio
**Estado:** Aprobado — en ejecucion

## Contexto

ONE genera PDFs (cotizaciones, propuestas, radiografias) usando `@react-pdf/renderer`. Limitaciones:
- Calidad visual: layouts complejos requieren codigo React, no HTML/CSS reusable
- Branding por workspace: cada cliente Clarity quiere su propio formato (caso WMC validado 2026-05-13/14)
- Paginacion: chrome --print-to-pdf y react-pdf no manejan bien running headers/footers ni page counters
- Reuso: el template generado para un cliente no es reutilizable en otros contextos

WeasyPrint resuelve esto con CSS Paged Media nativo (`position: running()`, `@page` margin boxes, `counter(page)`). Validado en `proyectos/wmc/_templates/cotizacion-wmc/` con resultado canonico.

## Decision

Crear un servicio Python serverless dedicado a render de PDFs. Vive aparte de ONE para:
- Aislar dependencias del sistema (pango, cairo, weasyprint)
- Permitir deploy independiente y escalado horizontal
- Reusar desde ONE, futuros productos MeTRIK, automatizaciones externas

## Arquitectura

```
[ONE (Next.js)] --HTTPS-> [metrik-pdf-render (Flask + WeasyPrint)] -> PDF
                                                     |
                                                     v
                                          [Supabase Storage assets]
```

### Repo `metrik-pdf-render`

GitHub: `bi-metrik/metrik-pdf-render`
Stack: Python 3.12, Flask, WeasyPrint
Deploy: Fly.io (free tier — 256MB RAM suficiente para nuestro volumen)
Auth: shared secret en header `X-MeTRIK-Secret`

### Endpoint

```
POST /render/cotizacion
Headers: X-MeTRIK-Secret: <env>
Body (JSON):
{
  "template_slug": "wmc",
  "data": {
    "numero_cot": "...",
    "cliente": "...",
    "nit_cliente": "...",
    "proyecto": "...",
    "fecha": "...",
    "items": [{ "numero": 1, "descripcion": "...", "cantidad": "...", ... }],
    "subtotal": "...",
    "iva_pct": 19,
    "iva_valor": "...",
    "valor_total_con_iva": "...",
    "lugar_entrega": "...",
    "validez_dias": 30,
    "tiempo_entrega": "...",
    "anticipo_pct": 35,
    "anticipo_valor": "...",
    "saldo_terminos": "...",
    "observaciones_extra": ["...", "..."],
    "powered_by_metrik": true
  }
}
Response: application/pdf (binary)
```

### Templates

Versionados en el repo: `metrik-pdf-render/templates/{slug}/cotizacion.html`
- `templates/wmc/cotizacion.html` — el validado en sesion 2026-05-13/14
- `templates/wmc/assets/logo-wmc-header.jpeg`
- `templates/metrik/cotizacion.html` — default MeTRIK (pendiente, fase 2)

Templates leen variables via `{{placeholder}}` (substitucion en Python antes de render).

## Cambios en ONE (Fase 2)

### Migration nueva

```sql
-- 20260515_pdf_render_serverless.sql

-- Campos faltantes en cotizaciones para parametrizar templates
ALTER TABLE cotizaciones
  ADD COLUMN lugar_entrega TEXT,
  ADD COLUMN tiempo_entrega TEXT,
  ADD COLUMN anticipo_pct NUMERIC(5,2),
  ADD COLUMN anticipo_terminos TEXT,
  ADD COLUMN saldo_terminos TEXT,
  ADD COLUMN observaciones_extra JSONB DEFAULT '[]';

-- Template por workspace
ALTER TABLE workspaces
  ADD COLUMN cotizacion_template_slug TEXT NOT NULL DEFAULT 'metrik';

-- Config defaults por workspace (en modulos_config JSONB existente)
-- Ejemplo de payload nuevo:
-- modulos_config.cotizacion = {
--   default_anticipo_pct: 35,
--   default_validez_dias: 30,
--   default_observaciones: ["...", "..."],
--   powered_by_metrik: true
-- }

-- Seed inicial para WMC
UPDATE workspaces SET cotizacion_template_slug = 'wmc' WHERE slug = 'wmc';
```

### Endpoint en ONE

`src/app/(app)/negocios/cotizacion-pdf-actions.ts` reemplaza `generateCotizacionPDF()`:
- Construye payload JSON desde `cotizacion` + `items` + `workspace.cotizacion_template_slug`
- Llama a `metrik-pdf-render/render/cotizacion` con secret
- Recibe PDF, retorna al cliente
- Si `workspace.drive_folder_id` AND `negocio.carpeta_drive_id` existen, sube copia a `<carpeta_negocio>/cotizaciones/{codigo}.pdf`

### Editor UI (BloqueCotizacion)

Agregar inputs para los nuevos campos en `src/app/(app)/negocios/cotizacion-editor.tsx`:
- Lugar de entrega
- Tiempo de entrega
- Anticipo % + terminos
- Saldo terminos
- Observaciones extras (lista editable)

Los defaults vienen de `workspace.modulos_config.cotizacion`.

## Plan de implementacion

### Fase 1 — Servicio WeasyPrint (esta sesion)
1. Crear repo `bi-metrik/metrik-pdf-render`
2. Flask app con endpoint `/render/cotizacion`
3. Template `wmc/cotizacion.html` (copiar del validado)
4. Test local con curl
5. Deploy a Fly.io
6. Documentar secret y URL en `.credentials.md` (Kaori)

### Fase 2 — Integracion ONE
1. Migration con campos nuevos
2. Actualizar `cotizacion-pdf-actions.ts` para llamar al servicio
3. Actualizar `cotizacion-editor.tsx` con inputs nuevos
4. Configurar `cotizacion_template_slug = 'wmc'` para workspace WMC
5. Subir logo WMC a Supabase Storage o servir desde el repo
6. Drive upload helper para guardar copia en carpeta del negocio

### Fase 3 — Generalizacion (post-MVP)
- Otros templates por workspace (Dimpro, SOENA, ALMA)
- Extender el servicio a otros documentos (propuestas, radiografias, OC)
- Migrar 100% de PDFs de ONE a WeasyPrint, deprecar `@react-pdf/renderer`

## Riesgos

| Riesgo | Mitigacion |
|---|---|
| Fly.io free tier insuficiente | Migrar a paid plan ($5/mes) o auto-scale. Capacidad: ~10K renders/mes free |
| Cold start lento (Python serverless ~3-5s) | WeasyPrint precarga el primer render. Aceptable para flujo "export PDF" no realtime |
| Secret expuesto | Rotar shared secret cada 90 dias. Documentar en `.credentials.md` |
| Drift entre templates locales (proyectos/) y servicio | Solo el servicio es fuente unica de verdad. Local queda como playground |

## Out of scope (NO en este spec)

- Editor visual de templates en ONE
- Generacion de templates desde IA
- Firma electronica integrada (eso queda con ZapSign)
- Cache de PDFs (cada render es one-shot, no se almacena en el servicio)

## Referencias

- Template WMC validado: `proyectos/wmc/_templates/cotizacion-wmc/template.html`
- Sesion de captura: 2026-05-13 a 2026-05-15 (`wmc--inspeccion-escaleras`)
- Patron correcto Powered by MéTRIK: `cerebro/reglas/powered-by-metrik.md`
