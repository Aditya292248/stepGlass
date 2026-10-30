/** Directories that make up the domain-agnostic core. */
export const CORE_ROOTS = ['apps', 'packages'] as const

/** Words that only belong in connectors/ or scenarios/. Matched as word prefixes, case-insensitive. */
export const DOMAIN_WORDS = ['refund', 'budget', 'gmail', 'slack', 'stripe', 'mailbox', 'invoice']

/** File extensions scanned for violations. Markdown is skipped so docs can use examples. */
export const SCANNED_EXTENSIONS = [
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.json',
	'.css',
	'.html',
]

export interface Violation {
	file: string
	line: number
	message: string
}

const FORBIDDEN_PACKAGE = /^@stepglass\/(connector|scenario)-/
const FORBIDDEN_PATH = /(^|\/)(connectors|scenarios)\//
const IMPORT_SPECIFIER =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g
const DOMAIN_WORD = new RegExp(`\\b(${DOMAIN_WORDS.join('|')})`, 'i')

/** Checks one core source file. `file` is the repo-relative path with forward slashes. */
export function checkSource(file: string, content: string): Violation[] {
	const violations: Violation[] = []
	const lines = content.split('\n')

	lines.forEach((text, index) => {
		const line = index + 1
		for (const match of text.matchAll(IMPORT_SPECIFIER)) {
			const specifier = match[1] ?? ''
			if (FORBIDDEN_PACKAGE.test(specifier) || isPathIntoDomainLayer(file, specifier)) {
				violations.push({ file, line, message: `core must not import "${specifier}"` })
			}
		}
		const word = DOMAIN_WORD.exec(text)
		if (word) {
			violations.push({ file, line, message: `domain word "${word[1]}" in core code` })
		}
	})

	return violations
}

/** Checks a core package.json for dependencies on connectors or scenarios. */
export function checkManifest(file: string, manifest: Record<string, unknown>): Violation[] {
	const violations: Violation[] = []
	for (const field of [
		'dependencies',
		'devDependencies',
		'peerDependencies',
		'optionalDependencies',
	]) {
		const deps = manifest[field]
		if (typeof deps !== 'object' || deps === null) continue
		for (const name of Object.keys(deps)) {
			if (FORBIDDEN_PACKAGE.test(name)) {
				violations.push({ file, line: 1, message: `core must not depend on "${name}"` })
			}
		}
	}
	return violations
}

function isPathIntoDomainLayer(file: string, specifier: string): boolean {
	if (!specifier.startsWith('.')) return false
	const segments = file.split('/').slice(0, -1)
	for (const part of specifier.split('/')) {
		if (part === '..') segments.pop()
		else if (part !== '.') segments.push(part)
	}
	return FORBIDDEN_PATH.test(`${segments.join('/')}/`)
}
