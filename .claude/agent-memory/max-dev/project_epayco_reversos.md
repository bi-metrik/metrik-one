---
name: project-epayco-reversos
description: Reverso de pagos ePayco (estado 6) — ePayco SÍ manda la confirmación del 6 (390720992-6); webhook + conciliación 7d anulan el cobro; desde 27-oct el ciclo de Valida se corta
metadata:
  type: project
---

La 390720992 (cobro f5f27bbf) se aprobó y Mauricio la reversó desde el panel el 2026-10-22. **ePayco SÍ llamó la
confirmación con el 6**: `pasarela_eventos` 390720992-6, `recibido_at` 16:45:13Z, payload completo de ePayco
(3 min después de la anulación manual de 16:42Z). El 23-oct se creyó que no (memoria y bitácora de pruebas lo
decían): verificado por SELECT el 26-oct. El código de ese día lo dejaba en `requiere_revision`.
#1259 (mergeado 23-oct): webhook con el 6 anula; paso 7d del cron (`detectarReversosEpayco`, 60 días, tope 80)
consulta y procesa con el mismo id `<ref>-6`. Es red, no el camino principal.
PR fix/valida-cobro-pendiente-y-reverso (26-oct): el reverso MARCA `config_extra.valida_plan.reversado` si ese
cobro abrió el ciclo vigente, y lo dice en evento y correo. No lo cierra: metrik-valida no tiene ruta para cerrar
un ciclo (solo `POST /autogestion/{cliente}/ciclos`).

Actualización 27-oct: Mauricio decidió que el reverso corta el plan en el acto: ver [[project-valida-reverso-corta-plan]].

**Why:** cancelar la suscripción, cerrar el ciclo de Valida o recobrar la cuota es tema de Términos: Mauricio lo
decide con Emilio. Por eso el cobro anulado CONSERVA `fecha` (el cron lo trata como cuota cubierta).

**How to apply:**
- Doc oficial (docs.epayco.com/docs/url-de-confirmacion): 6 = Reversada, solo tarjeta, desde el panel el mismo día
  hasta 9 p. m.; después por la red. 7 = retenido (solo modelo agregado). No hay código de contracargo.
- Bold (VOID_APPROVED) sigue en revisión manual a propósito.
- `pasarela_eventos.resultado` tiene CHECK: no hay valor «anulado»; el reverso queda `requiere_revision`.
- El espacio afi-prueba-produccion-1 se borró el 26-oct (cobro f5f27bbf ya no existe; el intento 3491f39f sí).
