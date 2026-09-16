---
name: texto-pdf-pypdfium2
description: Extraer el texto de un PDF de Chromium (contratos, recibos Pino Profundo) en la torre sin instalar nada: pypdfium2 ya esta en la cache de uv
metadata:
  type: reference
---

No hay poppler, pypdf ni pypdfium2 instalados, pero **pypdfium2 vive en la caché de uv** y carga
con `PYTHONPATH` (medido el 2026-09-16):

```bash
PYTHONPATH=/home/mauricio/.cache/uv/archive-v0/XP5zxWGnVhenzort python3 -c "
import pypdfium2 as p; d=p.PdfDocument('<archivo.pdf>')
print(''.join(d[i].get_textpage().get_text_range() for i in range(len(d))))"
```

Sirve para los PDF impresos desde HTML (Chromium), donde `scripts/leer-pdf.mjs` no aplica.

⚠️ Al comparar contra el `.md` fuente: **el pie de cada página queda pegado a la primera línea de
la siguiente** (sin salto) y los enlaces largos salen partidos. Quitar el pie con una regex antes de
partir en palabras, o el diff marca párrafos enteros como ausentes.

Relacionado: [[mirar-pdf-renderizado]], [[leer-texto-de-un-pdf-de-react-pdf]].
