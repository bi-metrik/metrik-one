// ============================================================
// NIT Validation — Colombian Modulo-11 Algorithm
// Spec: [98B] D73
// ============================================================

const WEIGHTS = [71, 67, 59, 53, 47, 43, 41, 37, 29, 23, 19, 17, 13, 7, 3]

/**
 * Validates a Colombian NIT using the modulo-11 algorithm.
 * @param nit — NIT digits only (without DV), e.g. "900123456"
 * @param dv — Digito de verificacion, e.g. "7"
 * @returns true if the DV matches the calculated check digit
 */
export function validateNit(nit: string, dv: string): boolean {
  // Clean inputs
  const cleanNit = nit.replace(/[.\-\s]/g, '')
  const cleanDv = dv.trim()

  if (!cleanNit || !cleanDv) return false
  if (!/^\d+$/.test(cleanNit) || !/^\d$/.test(cleanDv)) return false

  // Pad NIT to 15 digits from the right (weights align from right to left)
  const padded = cleanNit.padStart(15, '0')

  let sum = 0
  for (let i = 0; i < 15; i++) {
    sum += parseInt(padded[i]) * WEIGHTS[i]
  }

  const remainder = sum % 11
  let expectedDv: number

  if (remainder === 0) {
    expectedDv = 0
  } else if (remainder === 1) {
    expectedDv = 1
  } else {
    expectedDv = 11 - remainder
  }

  return parseInt(cleanDv) === expectedDv
}

/**
 * Calculates the expected DV for a given NIT.
 * Useful for suggesting corrections when OCR gets the DV wrong.
 */
export function calculateDv(nit: string): number | null {
  const cleanNit = nit.replace(/[.\-\s]/g, '')
  if (!cleanNit || !/^\d+$/.test(cleanNit)) return null

  const padded = cleanNit.padStart(15, '0')

  let sum = 0
  for (let i = 0; i < 15; i++) {
    sum += parseInt(padded[i]) * WEIGHTS[i]
  }

  const remainder = sum % 11
  if (remainder === 0) return 0
  if (remainder === 1) return 1
  return 11 - remainder
}
