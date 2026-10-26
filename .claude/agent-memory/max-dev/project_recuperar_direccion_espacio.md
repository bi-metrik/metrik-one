---
name: recuperar-direccion-espacio
description: Recuperar la dirección del espacio por correo en metrikone.co/login y bienvenida del alta de Valida (2026-10-22); tope en memoria + idempotencia de Resend; textos en src/lib/acceso-espacio/textos.ts
metadata:
  type: project
---

PR #1242 (feat/login-recuperar-espacio-y-bienvenida-valida, 2026-10-22), sin migración. Textos pendientes de aprobación de Mauricio.

- `POST /api/acceso/recuperar-espacio` responde siempre `{ ok: true }` (salvo 422 por formato); búsqueda y envío en `after()`.
- El repo NO tiene limitador compartido: el tope es por instancia (`LimiteEnMemoria`). Lo que sí frena entre instancias es la `Idempotency-Key` de Resend (huella del correo + ventana de 10 min).
- Bienvenida de Valida sale en `crearEspacioValida` tras perfil y staff, NO en `reintentarPruebaPendiente`.
- Marca por correo en `MARCAS` (textos.ts): bienvenida = Valida; recuperación = Valida solo si TODOS los espacios son solo Valida (`esEspacioSoloValida`). Valida no publica lockup en PNG: el nombre va en texto.

**Why:** quien se registraba en /valida/empezar no sabía su slug (derivado de la razón social) ni recibía correo.

**How to apply:** si Mauricio pide un tope duro entre instancias, hace falta tabla (decisión suya). Textos nuevos de acceso van a `textos.ts`, no sueltos. Ver [[valida-alta-autogestionada]].
