/** 32-bit FNV-1a with a seed, so several independent words can come from one key. */
function fnv1a(key: string, seed: number): number {
	let h = (0x811c9dc5 ^ seed) >>> 0
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i)
		h = Math.imul(h, 0x01000193) >>> 0
	}
	return h
}

const hex = (n: number, width: number) => n.toString(16).padStart(width, '0').slice(-width)

/**
 * A UUIDv7 derived from a timestamp and a key instead of a clock and a random source. The same
 * check over the same session prefix always gets the same ID, so re-evaluation is idempotent and
 * the engine stays pure. It is an identifier, not a secret.
 */
export function deterministicUuidv7(ms: number, key: string): string {
	if (!Number.isSafeInteger(ms) || ms < 0 || ms >= 2 ** 48) {
		throw new Error(`timestamp ${ms} does not fit a UUIDv7`)
	}
	const [a = 0, b = 0, c = 0] = [1, 2, 3].map((seed) => fnv1a(key, seed))
	const time = hex(ms, 12)
	const randA = hex(a & 0xfff, 3)
	const variant = hex(0x8000 | (b & 0x3fff), 4)
	const randB = hex(b >>> 16, 4) + hex(c, 8)
	return `${time.slice(0, 8)}-${time.slice(8)}-7${randA}-${variant}-${randB}`
}
