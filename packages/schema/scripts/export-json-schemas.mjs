// Writes dist/json-schema/<Contract>.json from the built package, for non-TypeScript clients.
import { mkdir, writeFile } from 'node:fs/promises'
import { exportJsonSchemas } from '../dist/index.js'

const outDir = new URL('../dist/json-schema/', import.meta.url)
await mkdir(outDir, { recursive: true })
for (const [name, schema] of Object.entries(exportJsonSchemas())) {
	await writeFile(new URL(`${name}.json`, outDir), `${JSON.stringify(schema, null, '\t')}\n`)
}
