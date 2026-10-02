---
name: verificar-contra-texto-pdf
description: 2026-10-02 — lo que lee Gemini de un PDF se verifica contra su capa de texto (unpdf) al extraer; corrige solo confusiones típicas; barrido SOENA = 4 campos; script de corrección sin correr
metadata:
  type: project
---

Brief `proyectos/soena/ve/2026-10-02_brief-max-correo-contra-texto-pdf.md` (V0514: «vxpatem» vs «VXPATERN»).
Rama `fix/correo-contra-texto-pdf`. Sin migración; dependencia nueva `unpdf`.

- La regla vive en `extractFieldsFromDocument` (todas las rutas: carga, reproceso, facturación, scripts).
  Decide el TIPO por la forma del valor, no por el slug: genérica, sin config.
- Corrige solo a 1-2 confusiones de la lista y con candidato ÚNICO. Un documento solo dígitos nunca se
  corrige (ninguna confusión va de dígito a dígito): ahí la regla solo verifica.
- ⚠️ Lo que el barrido sí encontró NO lo arregla la regla: 3 radicados UPME con 0 donde el PDF dice 9
  (V0025, V0040, V0064; la IA «normaliza» hacia el ejemplo VEH_GEE2026… del prompt). El script los
  propone solo con `--con-digitos`. V0517 es NIT con DV pegado (el cruce `id_prefix` lo tolera).
- Los 4 avisos de correo del brief (V0283, V0529, V0539, V0537) son reales: el PDF y el RUT dicen
  correos distintos. V0529/V0539 son escaneos (sin capa): se leyeron mirando la imagen.
- `unpdf` exige Node ≥22 en `engines` pero corre en Node 20 (CI): medido con un binario de Node 20 en /tmp.

**Why:** un aviso falso de correo manda a revisar o re-radicar sin necesidad (V0129 radicó dos veces).

**How to apply:** para medir prod sin escribir, el patrón fue: SQL por la Management API → rclone
`copyid` a /tmp → `textoDelPdf` + `estaEnTexto` en un tsx de /tmp (`npx tsx --tsconfig <worktree>/tsconfig.json`,
sin el flag los alias `@/` no resuelven fuera del repo). Relacionado: [[falsos-avisos-certificado]],
[[certificado-correo-contacto]].
