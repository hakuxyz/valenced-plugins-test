import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { PreviewSample } from '../plugins/themes/shared'

const PagesDir = 'build/pages'
const PacksDir = join(PagesDir, 'packs')
const FixedMtime = new Date('2000-01-01T00:00:00Z')

rmSync(PagesDir, { recursive: true, force: true })
mkdirSync(PagesDir, { recursive: true })
mkdirSync(PacksDir, { recursive: true })

let count = 0

for (const name of [...readdirSync('plugins')].sort()) {
	const pluginDir = join('plugins', name)
	const manifestPath = join(pluginDir, 'manifest.json')
	if (!existsSync(manifestPath)) continue

	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
		id: string
		version: string
	}
	const bundlePath = join(pluginDir, 'build', 'js', 'index.js')
	if (!existsSync(bundlePath)) {
		throw new Error(`Missing ${bundlePath}. Run "bun run build" first.`)
	}

	const archive: Record<string, Uint8Array> = {
		'manifest.json': new Uint8Array(readFileSync(manifestPath)),
		'index.js': new Uint8Array(readFileSync(bundlePath)),
	}

	const zipped = zipSync(archive, { mtime: FixedMtime })
	const fileName = `${manifest.id}@${manifest.version}.zip`

	writeFileSync(join(PagesDir, fileName), zipped)
	count++
	console.log(`Packed ${fileName}`)
}

// Emoji packs are downloaded on demand from plugin settings, not bundled in
// the plugin ZIP. Each pack is a separate ZIP served from GitHub Pages.
for (const name of [...readdirSync('plugins/themes/assets/emoji')].sort()) {
	const packDir = join('plugins/themes/assets/emoji', name)
	if (!existsSync(packDir)) continue

	const archive: Record<string, Uint8Array> = {}
	for (const entry of readdirSync(packDir)) {
		const path = join(packDir, entry)
		if (entry.endsWith('.png') || entry.endsWith('.txt'))
			archive[entry] = new Uint8Array(readFileSync(path))
	}

	writeFileSync(
		join(PacksDir, `${name}.zip`),
		zipSync(archive, { mtime: FixedMtime }),
	)
	count++
	console.log(`Packed pack ${name}.zip`)
}

// Metadata with each pack's download size, shown in plugin settings.
const meta: Record<string, number> = {}
for (const name of [...readdirSync('plugins/themes/assets/emoji')].sort()) {
	const zipPath = join(PacksDir, `${name}.zip`)
	if (existsSync(zipPath)) meta[name] = readFileSync(zipPath).length
}
writeFileSync(
	join(PacksDir, 'meta.json'),
	new Uint8Array(Buffer.from(JSON.stringify(meta))),
)
count++

// Sample emoji per pack, shown as preview rows in settings before download.
const previewsDir = join(PacksDir, 'previews')
mkdirSync(previewsDir, { recursive: true })
for (const name of [...readdirSync('plugins/themes/assets/emoji')].sort()) {
	const dir = join(previewsDir, name)
	mkdirSync(dir, { recursive: true })
	for (const codepoint of PreviewSample) {
		const src = join(
			'plugins/themes/assets/emoji',
			name,
			`emoji-${codepoint}.png`,
		)
		if (existsSync(src))
			writeFileSync(join(dir, `${codepoint}.png`), readFileSync(src))
	}
}

console.log(`Packed ${count} plugin/pack artifact(s) into ${PagesDir}`)
