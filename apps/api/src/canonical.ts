/**
 * JSON with object keys sorted at every level, so two documents compare equal exactly when they
 * hold the same data, whatever key order the producer or jsonb happened to use.
 */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, v: unknown) => {
		if (v === null || typeof v !== 'object' || Array.isArray(v)) return v
		return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
	})
}

/** Postgres jsonb rejects U+0000 in strings, so such documents are refused before storage. */
export function containsNul(value: unknown): boolean {
	if (typeof value === 'string') return value.includes('\u0000')
	if (Array.isArray(value)) return value.some(containsNul)
	if (value !== null && typeof value === 'object') {
		return Object.entries(value).some(([k, v]) => k.includes('\u0000') || containsNul(v))
	}
	return false
}
