/**
 * Normalizes primitive and Photoshop-style unit values at external data boundaries.
 */
export function normalizeFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (!value || typeof value !== 'object' || !('value' in value)) {
    return undefined;
  }

  const nestedValue = value.value;
  return typeof nestedValue === 'number' && Number.isFinite(nestedValue)
    ? nestedValue
    : undefined;
}
