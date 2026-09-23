---
name: anio-inferido-y-marco-identico
description: Trappvel 2026-09-23 — año de fechas sin año se deduce (#880) y la cotización vive dentro del marco real del negocio (#882); ambos mergeados
metadata:
  type: project
---

**#880 (mergeado):** `src/lib/cotizaciones/anio-fecha.ts` deduce el año de «Lun, 23 Nov». El prompt pide el sufijo `--MM-DD/lun`; **verificado con Gemini vivo** sobre 4 capturas sin año: devuelve `--11-23/lun` y el resultado sale sin aviso. Con año visible el modelo devuelve `2026-11-09/lun` (se limpia con `fechaSinDiaDeLaSemana`). El aviso viejo «se completa con el del viaje» se filtra al leer en `leerTarifaPax`, sin backfill.

**Why:** cada vuelo salía en «Requiere atención» y el aviso enseñaba a ignorar avisos.

**How to apply:** si reaparece un aviso de año, mirar primero si el día de la semana no coincide (regla 4) antes de tocar el prompt. ⚠️ La guarda `retencion.test.ts` rechaza cualquier archivo con «N años» en prosa (me tumbó «dos años posibles» en un comentario): redactar sin cifra + «años».

**#882 (mergeado):** la cotización pinta `NegocioDetailClient` con `centro={editor}`; datos por `cargarVistaNegocio` (vista-negocio.tsx). Encabezado 0 píxeles distintos a 1440 y 390. Quedan SIN decidir (se dejaron por «sin variación»): «← Negocios», Desistir, carpeta Drive, barra de etapas y resumen de contacto móvil dentro de la cotización.

Arnés de capturas sin sesión: ruta temporal fuera de `(app)` + `.env.local` symlink (el middleware exige la URL de Supabase aunque la ruta sea pública). Ver [[capturas-ui-sin-servidor]].
