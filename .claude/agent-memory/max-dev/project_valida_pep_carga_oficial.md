---
name: valida-pep-carga-oficial
description: metrik-valida #69 (22-oct): PEP desde el archivo oficial del DAFP por endpoint/CLI; migración 0040 (bucket) SIN aplicar; carga en prod SIN correr; ventana de 2 años congelada entre cargas
metadata:
  type: project
---

PR bi-metrik/metrik-valida#69 (rama feat/pep-carga-oficial-xlsx), sin mergear al 2026-10-22.

- Carga: `POST /api/admin/ingesta/pep_colombia/archivo` o `scripts/cargar-pep-oficial.ts` (con `--solo-leer` = ensayo sin base). Vercel corta >4,5 MB: si el zip pesa más, CLI.
- Versión oficial = `metadata.origen='archivo_oficial'` + `procedencia`; el cron la omite salvo `rowsUpdatedAt` de datos.gov.co posterior al corte.
- 0040 (bucket `fuentes-oficiales`) SIN aplicar; sin ella la carga va igual con `archivo_guardado=null`.
- Mientras la vigente sea oficial, nadie sale por cumplir 2 años hasta la próxima carga (conservador). Re-evaluar desde Storage quedó para otro PR.

**Why:** la copia 3qxn-uc22 está congelada desde 2026-04-10; la descarga oficial tiene reCAPTCHA v3 y no se automatiza.
**How to apply:** la carga en prod la aprueba Mauricio; no correrla ni aplicar 0040 sin su OK. Ver [[sql-y-despliegue-metrik-valida]] y [[publicar-otro-repo-desde-worktree-aislado]] (el clon dentro del worktree sigue funcionando).
