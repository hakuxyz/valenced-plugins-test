import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { FileModule } from '@valenced/discord/native'
import { reloadApp } from '@valenced/modules/native/app'
import { pluginStorageDirFor } from '@valenced/plugins/constants'
import { unzipSync } from 'fflate'
import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { DefaultSettings, GroupId, PACKS } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Pack, Settings } from './shared'

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

const PacksBaseUrl = 'https://hakuxyz.github.io/valenced-plugins-test/packs'
const PacksMetaUrl = `${PacksBaseUrl}/meta.json`

const { TableRowGroup, Text, Button } = Design

/** Converts raw bytes to a human readable size. */
function formatSize(bytes: number): string {
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

/** Runs `task` for each item, `concurrency` at a time. */
async function concurrently<T>(
	items: T[],
	concurrency: number,
	task: (item: T) => Promise<void>,
) {
	let index = 0
	const workers = () =>
		Promise.all(
			Array.from({ length: concurrency }, () => {
				let item: T | undefined
				return new Promise<void>(resolve => {
					const next = () => {
						item = items[index++]
						if (item === undefined) return resolve()
						task(item).then(next)
					}
					next()
				})
			}),
		)
	await workers()
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

	const isDownloaded = (id: string) => downloaded.has(id)

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

			const next = {
				...settings,
				selected: id,
				downloaded: [...downloaded, id],
			}
			await storage.set(next)
			await reloadApp()
			setDownloading(prev => {
				const nextSet = new Set(prev)
				nextSet.delete(id)
				return nextSet
			})
		} catch (e) {
			setError(
				`Failed to download ${pack.name}: ${
					e instanceof Error ? e.message : String(e)
				}`,
			)
			setDownloading(prev => {
				const nextSet = new Set(prev)
				nextSet.delete(id)
				return nextSet
			})
		}
	}

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
					Choose an emoji pack. Packs are downloaded on demand and are not
					included in the installed plugin ZIP. Changing packs requires an app
					reload.
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

				<TableRowGroup title="Packs">
					{PACKS.map(pack => {
						const id = pack.id
						const size = formatSize(sizes[id] ?? 0)
						const done = isDownloaded(id)
						return (
							<TableRowGroup title={pack.name} key={id}>
								<Text variant="text-xs/normal" style={{ marginBottom: 6 }}>
									{size} {done ? 'downloaded' : 'download to install'}
								</Text>
								<Button
									text={done ? 'Installed' : 'Download'}
									onPress={() => downloadPack(pack)}
									disabled={done || downloading.has(id)}
								/>
								{downloading.has(id) && (
									<Text variant="text-xs/normal" style={{ marginTop: 4 }}>
										Downloading...
									</Text>
								)}
							</TableRowGroup>
						)
					})}
				</TableRowGroup>
			</Page>
		</ScrollView>
	)
}
