export function deepClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function toNumber(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Valeur numerique invalide pour " + fieldName + ".");
  }
  return parsed;
}

export function uniqueValues(items) {
  return Array.from(new Set(items));
}
