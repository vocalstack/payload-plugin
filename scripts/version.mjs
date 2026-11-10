// Writes src/version.ts from package.json, so the plugin knows its own version
// without reading package.json at runtime (bundlers may not ship it).
import { readFileSync, writeFileSync } from 'node:fs'

const { name, version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const out = new URL('../src/version.ts', import.meta.url)
const body = `// Written by scripts/version.mjs from package.json. Do not edit.\nexport const PACKAGE_NAME = ${JSON.stringify(name)}\nexport const VERSION = ${JSON.stringify(version)}\n`
let prev = ''
try { prev = readFileSync(out, 'utf8') } catch {}
if (prev !== body) writeFileSync(out, body)
