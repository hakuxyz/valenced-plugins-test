import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { FileModule } from '@valenced/discord/native'
import { reloadApp } from '@valenced/modules/native/app'
import { pluginStorageDirFor } from '@valenced/plugins/constants'
import { unzipSync } from 'fflate'
import { useEffect, useState } from 'react'
import { Image, ScrollView, View } from 'react-native'
import { CATEGORIES, DefaultSettings, GroupId } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Pack, Settings } from './shared'

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

const PacksBaseUrl = 'https://hakuxyz.github.io/valenced-plugins-test/packs'
const PacksMetaUrl = `${PacksBaseUrl}/meta.json`

const { TableRow, TableRowGroup, Text, Button } = Design

function formatSize(bytes: number): string {
	if (!bytes) return '...'
	const units = ['B', 'KB', 'MB', 'GB']
	let size = bytes
	let unit = 0
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024
		unit++
	}
	return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function toBase64(bytes: Uint8Array): string {
	let binary = ''
	for (let i = 0; i < bytes.length; i += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	return btoa(binary)
}

async function concurrently<T>(
	items: T[],
	concurrency: number,
	task: (item: T) => Promise<void>,
) {
	let index = 0
	await Promise.all(
		Array.from({ length: concurrency }, () => {
			const next = (): Promise<void> => {
				const item = items[index++]
				if (item === undefined) return Promise.resolve()
				return task(item).then(next)
			}
			return next()
		}),
	)
}

export default function SettingsComponent({ api }: Props) {
	const { jsonStorage: storage } = api as any
	const [sizes, setSizes] = useState<Record<string, number>>({})
	const [downloading, setDownloading] = useState<Set<string>>(new Set())
	const [error, setError] = useState<string | null>(null)

	const manifestId = (api as any).plugin.manifest.id
	const themes = (api as any).themes
	const documentsDir = FileModule.getConstants().DocumentsDirPath

	const settings = storage.use() ?? DefaultSettings
	const downloaded = new Set(settings.downloaded ?? [])

	useEffect(() => {
		let cancelled = false
		fetch(PacksMetaUrl)
			.then(res => {
				if (!res.ok) throw new Error(`meta: ${res.status}`)
				return res.json() as Promise<Record<string, number>>
			})
			.then(meta => {
				if (!cancelled) setSizes(meta)
			})
			.catch(e => {
				if (!cancelled) setError(`Failed to load pack sizes: ${e.message}`)
			})
		return () => {
			cancelled = true
		}
	}, [])

	const packDirOf = (id: string) =>
		`${pluginStorageDirFor(manifestId)}/packs/${id}`

	async function downloadPack(pack: Pack) {
		const { id } = pack
		setDownloading(prev => new Set([...prev, id]))
		setError(null)
		try {
			const res = await fetch(`${PacksBaseUrl}/${id}.zip`)
			if (!res.ok) throw new Error(`Download failed: ${res.status}`)

			const bytes = new Uint8Array(await res.arrayBuffer())
			const files = unzipSync(bytes)
			const packDir = packDirOf(id)
			const base = packDir.slice(documentsDir.length + 1)

			await concurrently(
				Object.entries(files).filter(
					([name]) => name.endsWith('.png') || name.endsWith('.txt'),
				),
				24,
				async ([name, data]) => {
					await FileModule.writeFile(
						'documents',
						`${base}/${name}`,
						toBase64(data),
						'base64',
					)
				},
			)

			themes.registerEmojiPack(GroupId, id, {
				name: pack.name,
				images: packDir,
			})

			await storage.set({
				...settings,
				selected: id,
				downloaded: [...downloaded, id],
			})
			await reloadApp()
			setDownloading(prev => {
				const next = new Set(prev)
				next.delete(id)
				return next
			})
		} catch (e) {
			setError(
				`Failed to download ${pack.name}: ${
					e instanceof Error ? e.message : String(e)
				}`,
			)
			setDownloading(prev => {
				const next = new Set(prev)
				next.delete(id)
				return next
			})
		}
	}

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
					Choose an emoji pack. Packs are downloaded on demand. Changing packs
					requires an app reload.
				</Text>

				{error && (
					<View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
						<Text
							variant="text-xs/normal"
							style={{ opacity: 0.6, color: '#ff4444' }}
						>
							{error}
						</Text>
					</View>
				)}

				{CATEGORIES.map(category => (
					<TableRowGroup key={category.id} title={category.name}>
						<Text
							variant="text-xs/normal"
							style={{ paddingHorizontal: 16, paddingBottom: 8, opacity: 0.6 }}
						>
							{category.packs.length} pack
							{category.packs.length === 1 ? '' : 's'}
						</Text>
						{category.packs.map(pack => {
							const done = downloaded.has(pack.id)
							const busy = downloading.has(pack.id)
							const size = formatSize(sizes[pack.id] ?? 0)
							return (
								<TableRow
									key={pack.id}
									label={pack.name}
									subLabel={`${size}${done ? ' - installed' : ''}`}
									icon={
										<Image
											source={{
												uri: `${PacksBaseUrl}/previews/${pack.id}.png`,
											}}
											style={{ width: 28, height: 28, borderRadius: 4 }}
										/>
									}
									trailing={
										<Button
											size="sm"
											variant={done ? 'secondary' : 'primary'}
											text={done ? 'Installed' : busy ? '...' : 'Download'}
											disabled={done || busy}
											onPress={() => downloadPack(pack)}
										/>
									}
								/>
							)
						})}
					</TableRowGroup>
				))}
			</Page>
		</ScrollView>
	)
}
