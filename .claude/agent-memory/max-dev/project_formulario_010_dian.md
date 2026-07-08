---
name: formulario-010-dian
description: Cómo se arma el Formato 010 DIAN (AcroForm overlay) — aplanado, seccionales con código, capa editable
metadata:
  type: project
---

# Formato 010 DIAN — arquitectura de generación

El 010 se arma en `src/lib/pdf/formulario-010.ts` como overlay pdf-lib sobre el PDF
oficial (`templates/formulario-010-dian.pdf`). Orquestado por `generarFormularioCore`
en `src/lib/actions/formulario-actions.ts` → sube a Drive + versiona en `formulario_versiones`.

## PDF de salida es PLANO (no editable)
- Las casillas de datos variables se dibujan como AcroForm text fields (`addEditableField`
  en `acroform.ts`). **`generarFormulario010(datos, constantes, { flatten })`**: `flatten=true`
  (default) llama `form.flatten()` al final → 0 campos editables. `flatten=false` = debug.
- **Por qué es seguro aplanar:** la edición por seccional vive en plataforma
  (`data.campos_override` vía `BloqueFormulario` + `guardarFormularioOverrides`), NO en el
  PDF. La editabilidad del PDF era redundante. Reporte de Deisy (temía rechazo DIAN).
- Letra compacta: `DEFAULT_FONT_SIZE = 8` (default 9→8) vía helper `compact(cell)` para
  casillas sin `size` propio. NO mover posiciones Y (calibradas con pdftotext -bbox).

## Seccional (casilla 12) con código auto — A4
- `SECCIONALES_DIAN` (`src/lib/dian/seccionales.ts`) = catálogo oficial 39 seccionales,
  cada una con `codigo` (Res. 000064/2021) + `nombre_oficial`.
- `resolverSeccionalOficial(input, tipo_persona)` → `{ nombre_oficial, codigo }` o null.
  Resuelve por nombre oficial / ciudad / label. Bogotá: mismo código '32' ambos buzones.
- `aplicarSeccionalPreset` (formulario-actions): tras aplicar el preset curado, resuelve
  nombre_oficial + código del catálogo → casilla 12 muestra el NOMBRE OFICIAL COMPLETO
  (no "Cali") + `codigo_seccional`. El operador NO teclea el código. Fallback a mano si
  no hay match (ej. "Otras seccionales").
- Casilla 12 "Cód." se renderiza en `P1.codigo_seccional = { x:331, y:551, size:8 }`
  (label "Cód." bbox xMin≈318; correo casilla 14 en x=343 → caja estrecha para no chocar).

## Presets de seccional (config-driven, per-línea)
- Viven en DB: `bloque_configs.config_extra.seccionales` = mapa `{ nombreKey: { casilla vals } }`.
- SOENA GIT EV/HEV: 7 presets (Cali, Tuluá, Bogotá, Medellín, Bucaramanga, Barranquilla,
  Otras seccionales). Cali además: razon_social_cali, cod_representacion=18, casilla_1006.
- **Preset override es opt-in por clave (fix 2026-07-08):** `aplicarSeccionalPreset` sólo
  sobreescribe tipo_obligacion/concepto_saldo/nombre_documento cuando la clave ESTÁ en el
  preset (`preset.X != null`). Si se quita la clave, hereda el general de `campos_constantes`.
  (Antes forzaba '' con `?? ''` → borraba el general.) Así Cali hereda el general A1.
- **2 copias del 010:** bloques `e0e92bdb` (generación) + `8d70eb69` (envío). Ambas pasan
  por `generarFormulario010` → un fix en formulario-010.ts cubre las dos.
- El desplegable en `BloqueFormulario.tsx` lista las keys del preset (no las 39 crudas).

## Valores A1 verificados contra el ejemplo real (spec 2026-07-08)
Fuente de verdad: `proyectos/soena/ve/docs/entrada/ejemplo-010-diligenciado-deisy.pdf`
(caso Andrés Rodríguez Granados, Bogotá, aceptado por la DIAN).
- Casilla 2 concepto = `3` · 20 tipo doc = default `31` · 40 "Giro cuenta" (x=28,y=443)
- 44 = "A solicitud de parte" (SIN cambio) · 50 = `UPME` · 51 texto = `IVA` + Cód `175` (x=207,y=455)
- 53 período = FIJO `01` (NO bimestre calculado) · 57 = vacío · 1002 firma = `31` (no "CC")
- 45/60 titular/responsable = NIT+31 · 52 año = año factura · 55 = nº factura · 58 = fecha factura
- Constantes nuevas en la interfaz: `descripcion_forma_pago` (40), `codigo_concepto_saldo` (51 Cód).

## A5 — nombre de archivo en Drive = `config_extra.label`
- Generados: `fileName = \`${label}.pdf\`` (formulario-actions.ts:482).
- Cargados:  `fileName = \`${label}.${ext}\`` (documento-actions.ts:394).
- Renombrar el `label` renombra el archivo futuro Y el título del bloque en la plataforma
  (los generados ya usan labels numerados como título, ej. "007_010_...").
- 4 generados × 2 copias + 4 cargados primarios (con drive_subfolder, no heredado). Las
  copias readonly heredadas (heredado/source_bloque_slug) NO suben archivo propio.
- Ojo: SOENA tiene variantes fuera de la lista A5 (Comprobante pago UPME ≠ Concepto UPME;
  RUT solicitante 2; RUT del CDA) — confirmar con Mauricio antes de renombrarlas.

## Migraciones de config (SOENA-específicas)
- Van en `proyectos/soena/ve/migrations/` (superrepo metrik/, NO en metrik-one/supabase).
  El worktree de max-dev es solo metrik-one → esas migraciones se escriben vía Bash a la
  ruta compartida y se commitean aparte (fuera del PR de metrik-one).
- 2026-07-08: `20260708_010_valores_A1_cali_A2.sql` + `20260708_010_A5_nombres_documentos.sql`.
- Patrón: `jsonb_set(config_extra,'{campos_constantes}', ... || jsonb_build_object(...))`.

## Determinismo (ver aplicarDeterministas)
- DV recalculado módulo 11 (no confiar en extracción). Códigos DANE por nombre (divipola.ts).
- Todo respeta overrides con valor; override "" recalcula.

## Scripts de prueba (sin DB)
- `scripts/test-010.ts` → /tmp/test-010.pdf + cuenta campos editables (0 = plano OK).
- `scripts/qa-010-deisy.ts` → 28 asserts (A1 casilla por casilla + determinismo + A2 herencia
  Cali). Correr tras tocar el 010. Sus presets/constantes son COPIAS de la DB — actualizarlos
  cuando cambien los valores en las migraciones.
- `Formulario010Datos` requiere `codigo_seccional` (A4). Los scripts tipados deben incluirlo.
