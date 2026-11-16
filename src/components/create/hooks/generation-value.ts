// Generation DTOs contain plain values. Missing legacy optional fields and
// explicitly undefined fields represent the same cached generation.
export function sameGenerationValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameGenerationValue(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftFields = left as Record<string, unknown>;
  const rightFields = right as Record<string, unknown>;
  return [...new Set([...Object.keys(leftFields), ...Object.keys(rightFields)])]
    .every((key) => sameGenerationValue(leftFields[key], rightFields[key]));
}
