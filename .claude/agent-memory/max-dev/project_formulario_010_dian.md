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
  Otras seccionales). Cada uno con tipo_obligacion, concepto_saldo, nombre_documento,
  direccion_seccional (nombre corto), razon_social_cali/cod_representacion (solo Cali).
- **2 copias del 010:** bloques `e0e92bdb` (generación) + `8d70eb69` (envío). Ambas pasan
  por `generarFormulario010` → un fix en formulario-010.ts cubre las dos.
- El desplegable en `BloqueFormulario.tsx` lista las keys del preset (no las 39 crudas):
  es el subconjunto operativo, cada una ya autocompleta código vía el catálogo.

## Determinismo (ver aplicarDeterministas)
- DV recalculado módulo 11 (no confiar en extracción). Códigos DANE por nombre (divipola.ts).
- Todo respeta overrides con valor; override "" recalcula.

## Scripts de prueba (sin DB)
- `scripts/test-010.ts` → /tmp/test-010.pdf + cuenta campos editables (0 = plano OK).
- `scripts/qa-010-deisy.ts` → 21 asserts de los 9 bugs de Deisy. Correr tras tocar el 010.
- `Formulario010Datos` requiere `codigo_seccional` (agregado A4). Los scripts que lo
  construyen tipado deben incluirlo.
