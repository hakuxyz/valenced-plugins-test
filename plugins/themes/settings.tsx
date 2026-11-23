import Page from '@valenced/components/Page'
import { AlertActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { BundleUpdaterManager, FileModule } from '@valenced/discord/native'
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
const ReloadAlertKey = 'ThemesReloadRequired'

const { AlertActionButton, AlertModal, Button, TableRow, TableRowGroup, Text } =
	Design

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

function openReloadRequired() {
	AlertActionCreators.openAlert(
		ReloadAlertKey,
		<AlertModal
			title="Reload Required"
			content={
				<Text variant="text-md/medium" color="text-default">
					The following plugins require a reload to apply changes:
					{'\n'}
					<Text variant="text-md/bold" color="text-default">
						Themes
					</Text>
				</Text>
			}
			actions={
				<>
					<AlertActionButton
						variant="destructive"
						text="Reload"
						onPress={() => BundleUpdaterManager.reload()}
					/>
					<AlertActionButton
						variant="secondary"
						text="Not now"
						onPress={() => AlertActionCreators.dismissAlert(ReloadAlertKey)}
					/>
				</>
			}
		/>,
	)
}

export default function SettingsComponent({ api }: Props) {
	const { jsonStorage: storage, plugin } = api
	// Decorated by the Themes API plugin; untyped because it is not in the SDK.
	const themes = (api as any).themes
	const [sizes, setSizes] = useState<Record<string, number>>({})
	const [downloading, setDownloading] = useState<Set<string>>(new Set())
	const [error, setError] = useState<string | null>(null)
	const [openCategory, setOpenCategory] = useState<string | null>(null)

	const documentsDir = FileModule.getConstants().DocumentsDirPath

	const settings = storage.use() ?? DefaultSettings
	const selected = settings.selected
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
		`${pluginStorageDirFor(plugin.manifest.id)}/packs/${id}`

	async function selectDownloadedPack(pack: Pack) {
		try {
			themes.registerEmojiPack(GroupId, pack.id, {
				name: pack.name,
				images: packDirOf(pack.id),
			})
			await storage.set({ ...settings, selected: pack.id })
			openReloadRequired()
		} catch (e) {
			setError(
				`Failed to select ${pack.name}: ${
					e instanceof Error ? e.message : String(e)
				}`,
			)
		}
	}

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

			const nextDownloaded = downloaded.has(id)
				? settings.downloaded
				: [...(settings.downloaded ?? []), id]
			await storage.set({
				...settings,
				selected: id,
				downloaded: nextDownloaded,
			})
			openReloadRequired()
		} catch (e) {
			setError(
				`Failed to download ${pack.name}: ${
					e instanceof Error ? e.message : String(e)
				}`,
			)
		} finally {
			setDownloading(prev => {
				const next = new Set(prev)
				next.delete(id)
				return next
			})
		}
	}

	const activeCategory = CATEGORIES.find(c => c.id === openCategory)

	if (!themes)
		return (
			<ScrollView keyboardShouldPersistTaps="handled">
				<Page>
					<Text variant="text-md/normal">
						The Themes API is not available. Enable or install the Valenced
						Themes API plugin to use emoji packs.
					</Text>
				</Page>
			</ScrollView>
		)

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				{!activeCategory ? (
					<>
						<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
							Choose an emoji pack. Open a category to see its packs. Packs are
							downloaded on demand.
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

						<TableRowGroup title="Categories">
							{CATEGORIES.map(category => (
								<TableRow
									key={category.id}
									label={category.name}
									subLabel={`${category.packs.length} pack${
										category.packs.length === 1 ? '' : 's'
									} - ${category.packs.map(p => p.name).join(', ')}`}
									arrow
									onPress={() => setOpenCategory(category.id)}
								/>
							))}
						</TableRowGroup>
					</>
				) : (
					<>
						<Button
							size="sm"
							variant="secondary"
							text="Back"
							onPress={() => setOpenCategory(null)}
						/>
						<View style={{ height: 12 }} />

						<Text variant="text-lg/semibold" style={{ marginBottom: 4 }}>
							{activeCategory.name}
						</Text>
						<Text
							variant="text-sm/normal"
							style={{ marginBottom: 12, opacity: 0.7 }}
						>
							{activeCategory.packs.length} pack
							{activeCategory.packs.length === 1 ? '' : 's'}
						</Text>

						{error && (
							<View style={{ paddingBottom: 12 }}>
								<Text
									variant="text-xs/normal"
									style={{ opacity: 0.6, color: '#ff4444' }}
								>
									{error}
								</Text>
							</View>
						)}

						<TableRowGroup title="Packs">
							{activeCategory.packs.map(pack => {
								const done = downloaded.has(pack.id)
								const busy = downloading.has(pack.id)
								const active = selected === pack.id
								const size = formatSize(sizes[pack.id] ?? 0)
								return (
									<TableRow
										key={pack.id}
										label={pack.name}
										subLabel={`${size}${
											active ? ' - selected' : done ? ' - downloaded' : ''
										}`}
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
												variant={active ? 'secondary' : 'primary'}
												text={
													active
														? 'Selected'
														: busy
															? '...'
															: done
																? 'Use'
																: 'Download'
												}
												disabled={active || busy}
												onPress={() =>
													done ? selectDownloadedPack(pack) : downloadPack(pack)
												}
											/>
										}
									/>
								)
							})}
						</TableRowGroup>
					</>
				)}
			</Page>
		</ScrollView>
	)
}
