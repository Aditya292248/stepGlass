import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import {
	CORE_ROOTS,
	checkManifest,
	checkSource,
	SCANNED_EXTENSIONS,
	type Violation,
} from './check.ts'

const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage'])

/** Scans every core file under `repoRoot` and returns all boundary violations. */
export async function checkRepo(repoRoot: string): Promise<Violation[]> {
	const violations: Violation[] = []
	for (const root of CORE_ROOTS) {
		for await (const path of walk(join(repoRoot, root))) {
			const file = relative(repoRoot, path).split(sep).join('/')
			const content = await readFile(path, 'utf8')
			if (file.endsWith('/package.json')) {
				violations.push(...checkManifest(file, JSON.parse(content)))
			} else {
				violations.push(...checkSource(file, content))
			}
		}
	}
	return violations
}

async function* walk(dir: string): AsyncGenerator<string> {
	let entries: import('node:fs').Dirent[]
	try {
		entries = await readdir(dir, { withFileTypes: true })
	} catch {
		return
	}
	for (const entry of entries) {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (!SKIPPED_DIRS.has(entry.name)) yield* walk(path)
		} else if (SCANNED_EXTENSIONS.includes(extname(entry.name))) {
			yield path
		}
	}
}
