import Page from '@valenced/components/Page'
import { AlertActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { BundleUpdaterManager, FileModule } from '@valenced/discord/native'
import { pluginStorageDirFor } from '@valenced/plugins/constants'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { unzipSync } from 'fflate'
import { useEffect, useState } from 'react'
import { Image, ScrollView } from 'react-native'
import { writeEmojiSelection } from './native'
import { CATEGORIES, DefaultSettings, GroupId, PreviewSample } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Pack, Settings } from './shared'

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

const PacksBaseUrl = 'https://hakuxyz.github.io/valenced-plugins-test/packs'
const PacksMetaUrl = `${PacksBaseUrl}/meta.json`
const ReloadAlertKey = 'ThemesReloadRequired'
const UninstallAlertKey = 'ThemesUninstallConfirm'

const {
	AlertActionButton,
	AlertModal,
	Button,
	ContextMenu,
	Stack,
	TableRow,
	TableRowGroup,
	Text,
} = Design

function lookupIcon(...names: [string, ...string[]]) {
	try {
		return lookupGeneratedIconComponent(...names)
	} catch {
		return undefined
	}
}

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

/** Single sample emoji used as a row icon. */
function PreviewIcon({ packId }: { packId: string }) {
	return (
		<Image
			source={{
				uri: `${PacksBaseUrl}/previews/${packId}/${PreviewSample[0]}.png`,
			}}
			style={{ width: 28, height: 28, borderRadius: 4 }}
		/>
	)
}

/** The pack's sample emoji row, shown before download. */
function PreviewStrip({ packId }: { packId: string }) {
	return (
		<Stack direction="horizontal" spacing={4} style={{ flexWrap: 'wrap' }}>
			{PreviewSample.map(codepoint => (
				<Image
					key={codepoint}
					source={{
						uri: `${PacksBaseUrl}/previews/${packId}/${codepoint}.png`,
					}}
					style={{ width: 20, height: 20 }}
				/>
			))}
		</Stack>
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

function openUninstallConfirm(pack: Pack, onConfirm: () => void) {
	AlertActionCreators.openAlert(
		UninstallAlertKey,
		<AlertModal
			title={`Uninstall ${pack.name}?`}
			content={
				<Text variant="text-md/medium" color="text-default">
					This deletes the downloaded emoji files from your phone.
				</Text>
			}
			actions={
				<>
					<AlertActionButton
						variant="destructive"
						text="Uninstall"
						onPress={() => {
							AlertActionCreators.dismissAlert(UninstallAlertKey)
							onConfirm()
						}}
					/>
					<AlertActionButton
						variant="secondary"
						text="Cancel"
						onPress={() => AlertActionCreators.dismissAlert(UninstallAlertKey)}
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

	const selectionFor = (pack: Pack, images: string) => ({
		plugin: plugin.manifest.id,
		group: GroupId,
		pack: pack.id,
		images,
	})

	const settings = storage.use() ?? DefaultSettings
	const selected = settings.selected
	const downloaded = new Set(settings.downloaded ?? [])

	const UseIcon = lookupIcon('CheckmarkIcon', 'CircleCheckIcon')
	const DownloadIcon = lookupIcon('DownloadIcon', 'ArrowDownToLineIcon')
	const ReloadIcon = lookupIcon('RetryIcon', 'RefreshIcon', 'SyncIcon')
	const UninstallIcon = lookupIcon('TrashIcon', 'DeleteIcon')

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
			const packDir = packDirOf(pack.id)
			themes.registerEmojiPack(GroupId, pack.id, {
				name: pack.name,
				images: packDir,
			})
			await writeEmojiSelection(selectionFor(pack, packDir))
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
			await writeEmojiSelection(selectionFor(pack, packDir))

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

	async function uninstallPack(pack: Pack) {
		try {
			const base = packDirOf(pack.id).slice(documentsDir.length + 1)
			await FileModule.clearFolder('documents', base)
			const nextDownloaded = (settings.downloaded ?? []).filter(
				id => id !== pack.id,
			)
			const nextSelected = selected === pack.id ? null : selected
			await storage.set({
				...settings,
				downloaded: nextDownloaded,
				selected: nextSelected,
			})
			if (nextSelected === null) await writeEmojiSelection(null)
			openReloadRequired()
		} catch (e) {
			setError(
				`Failed to uninstall ${pack.name}: ${
					e instanceof Error ? e.message : String(e)
				}`,
			)
		}
	}

	const activeCategory = CATEGORIES.find(c => c.id === openCategory)
	const inUse = CATEGORIES.flatMap(category =>
		category.packs.map(pack => ({ pack, category })),
	).find(entry => entry.pack.id === selected)

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
		<ScrollView
			keyboardShouldPersistTaps="handled"
			contentContainerStyle={{ paddingBottom: 24 }}
		>
			<Page>
				{activeCategory ? (
					<Stack spacing={24}>
						<Button
							size="sm"
							variant="secondary"
							text="Back"
							onPress={() => setOpenCategory(null)}
						/>

						<Stack spacing={4}>
							<Text variant="heading-lg/bold" color="text-strong">
								{activeCategory.name}
							</Text>
							<Text variant="text-sm/normal" color="text-muted">
								{`${activeCategory.packs.length} pack${
									activeCategory.packs.length === 1 ? '' : 's'
								} - previewed below`}
							</Text>
						</Stack>

						{error && (
							<Text variant="text-sm/normal" style={{ color: '#ff4444' }}>
								{error}
							</Text>
						)}

						<TableRowGroup title="Packs">
							{activeCategory.packs.map(pack => {
								const done = downloaded.has(pack.id)
								const busy = downloading.has(pack.id)
								const active = selected === pack.id
								const size = formatSize(sizes[pack.id] ?? 0)
								const status = active
									? ' - in use'
									: done
										? ' - on this phone'
										: ''
								return (
									<ContextMenu
										key={pack.id}
										title={pack.name}
										triggerOnLongPress
										items={[
											done
												? {
														label: active ? 'Selected' : 'Use',
														IconComponent: UseIcon,
														action: () => {
															if (!active) void selectDownloadedPack(pack)
														},
													}
												: {
														label: 'Download',
														IconComponent: DownloadIcon,
														action: () => void downloadPack(pack),
													},
											...(done
												? [
														{
															label: 'Reload',
															IconComponent: ReloadIcon,
															action: () => void downloadPack(pack),
														},
													]
												: []),
											...(done
												? [
														{
															label: 'Uninstall',
															IconComponent: UninstallIcon,
															variant: 'destructive' as const,
															action: () =>
																openUninstallConfirm(
																	pack,
																	() => void uninstallPack(pack),
																),
														},
													]
												: []),
										]}
									>
										{props => (
											<TableRow
												{...{ onLongPress: props.onLongPress }}
												label={pack.name}
												subLabel={
													<Stack spacing={6}>
														<Text variant="text-sm/normal" color="text-muted">
															{`${size}${status}`}
														</Text>
														<PreviewStrip packId={pack.id} />
													</Stack>
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
															done
																? selectDownloadedPack(pack)
																: downloadPack(pack)
														}
													/>
												}
												disabled={busy}
												onPress={event => {
													if (props.onPress) props.onPress(event)
													else if (done && !active)
														void selectDownloadedPack(pack)
													else if (!done) void downloadPack(pack)
												}}
											/>
										)}
									</ContextMenu>
								)
							})}
						</TableRowGroup>
					</Stack>
				) : (
					<Stack spacing={24}>
						{error && (
							<Text variant="text-sm/normal" style={{ color: '#ff4444' }}>
								{error}
							</Text>
						)}

						{inUse && (
							<TableRowGroup title="In use" hasIcons>
								<TableRow
									label={inUse.pack.name}
									subLabel="Tap to browse its category"
									icon={<PreviewIcon packId={inUse.pack.id} />}
									arrow
									onPress={() => setOpenCategory(inUse.category.id)}
								/>
							</TableRowGroup>
						)}

						<TableRowGroup title="Categories" hasIcons>
							{CATEGORIES.map(category => (
								<TableRow
									key={category.id}
									label={category.name}
									subLabel={`${category.packs.length} pack${
										category.packs.length === 1 ? '' : 's'
									} - ${category.packs.map(pack => pack.name).join(', ')}`}
									icon={<PreviewIcon packId={category.packs[0].id} />}
									arrow
									onPress={() => setOpenCategory(category.id)}
								/>
							))}
						</TableRowGroup>

						<Text variant="text-sm/normal" color="text-muted">
							Packs are downloaded only when you pick one. The size is shown on
							every row, with a preview of that pack's emoji.
						</Text>
					</Stack>
				)}
			</Page>
		</ScrollView>
	)
}
