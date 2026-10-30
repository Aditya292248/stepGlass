const hex = (n: number, width: number) => n.toString(16).padStart(width, '0')

/**
 * Returns a UUIDv7 generator whose IDs sort in generation order, even within one millisecond or
 * when the clock steps back: the 12-bit `rand_a` field is a counter (RFC 9562, method 1) and the
 * timestamp never decreases.
 */
export function uuidv7Generator(clock: () => Date): () => string {
	let lastMs = -1
	let counter = 0
	return () => {
		let ms = clock().getTime()
		if (ms <= lastMs) {
			ms = lastMs
			counter += 1
			if (counter > 0xfff) {
				ms += 1
				counter = 0
			}
		} else {
			counter = 0
		}
		lastMs = ms
		const [a = 0, b = 0] = crypto.getRandomValues(new Uint32Array(2))
		const time = hex(ms, 12)
		const variant = hex(0x8000 | (a & 0x3fff), 4)
		return `${time.slice(0, 8)}-${time.slice(8)}-7${hex(counter, 3)}-${variant}-${hex(a >>> 16, 4)}${hex(b, 8)}`
	}
}
