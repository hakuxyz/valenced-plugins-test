import Page from '@valenced/components/Page'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { openColorPicker } from './color-picker'
import {
	colorLabel,
	colorToHex,
	colorValueToNumber,
	DefaultSettings,
	DefaultTagColor,
	hexToNumber,
	normalizeHex,
	PresetColorNames,
	PresetColors,
} from './shared'
import { setNote, setPendingGuildId } from './state'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { ServerNote, Settings } from './shared'

const { Button, TableRow, TableRowGroup, Text, TextInput } = Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

interface Guild {
	id: string
	name?: string | null
}

interface GuildStoreLike {
	getGuilds?(): Record<string, Guild>
	getGuild?(id: string): Guild | undefined
}

function getGuildStore(): GuildStoreLike | undefined {
	return (Stores as Record<string, unknown>).GuildStore as
		| GuildStoreLike
		| undefined
}

function guildName(id: string): string {
	const guild = getGuildStore()?.getGuild?.(id)
	return guild?.name ?? id
}

function allGuilds(): Guild[] {
	const guilds = getGuildStore()?.getGuilds?.()
	if (!guilds) return []
	return Object.values(guilds).sort((a, b) =>
		(a.name ?? '').localeCompare(b.name ?? ''),
	)
}

function ColorDot({ color, size = 18 }: { color: string; size?: number }) {
	return (
		<View
			style={{
				width: size,
				height: size,
				borderRadius: size / 2,
				backgroundColor: colorToHex(color),
				borderWidth: 1,
				borderColor: 'rgba(255,255,255,0.2)',
			}}
		/>
	)
}

function PresetPicker({
	value,
	onChange,
}: {
	value: string
	onChange: (color: string) => void
}) {
	return (
		<View
			style={{
				flexDirection: 'row',
				flexWrap: 'wrap',
				gap: 10,
				marginVertical: 8,
			}}
		>
			{Object.entries(PresetColors).map(([key, hex]) => {
				const selected = value === key
				return (
					<Pressable
						key={key}
						onPress={() => onChange(key)}
						style={{
							width: 32,
							height: 32,
							borderRadius: 16,
							backgroundColor: hex,
							borderWidth: selected ? 3 : 1,
							borderColor: selected ? '#ffffff' : 'rgba(255,255,255,0.2)',
						}}
						accessibilityLabel={PresetColorNames[key] ?? key}
					/>
				)
			})}
		</View>
	)
}

function EditNote({
	guildId,
	initial,
	onSave,
	onCancel,
	onDelete,
}: {
	guildId: string
	initial?: ServerNote
	onSave: (note: ServerNote) => void
	onCancel: () => void
	onDelete?: () => void
}) {
	const [note, setNoteText] = useState(initial?.note ?? '')
	const [color, setColor] = useState(initial?.color ?? DefaultTagColor)
	const [hexInput, setHexInput] = useState(
		initial?.color?.startsWith('#') ? initial.color : '',
	)
	const name = guildName(guildId)

	const applyHex = (value: string) => {
		setHexInput(value)
		const normalized = normalizeHex(value)
		if (normalized) setColor(normalized)
	}

	const pickCustom = () => {
		const currentNum = hexToNumber(
			color.startsWith('#') ? color : colorToHex(color),
		)
		const opened = openColorPicker({
			color: currentNum ?? undefined,
			onSelect: value => {
				const picked = colorValueToNumber(value)
				if (picked == null) return
				const hex = `#${picked.toString(16).padStart(6, '0')}`
				setColor(hex)
				setHexInput(hex)
			},
		})
		if (!opened) {
			ToastActionCreators.open('SERVER_NOTES_PICKER', {
				text: 'Color picker not available. Enter a hex value instead.',
				variant: 'critical',
			})
		}
	}

	return (
		<TableRowGroup title={initial ? 'Edit server note' : 'Add server note'}>
			<View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
				<Text variant="text-md/semibold" style={{ marginBottom: 2 }}>
					{name}
				</Text>
				<Text
					variant="text-xs/normal"
					style={{ opacity: 0.6, marginBottom: 10 }}
				>
					{guildId}
				</Text>

				<View
					style={{
						flexDirection: 'row',
						alignItems: 'center',
						gap: 10,
						marginBottom: 8,
					}}
				>
					<ColorDot color={color} size={24} />
					<Text variant="text-sm/medium">{colorLabel(color)}</Text>
				</View>

				<Text variant="text-sm/semibold" style={{ marginBottom: 4 }}>
					Preset colors
				</Text>
				<PresetPicker
					value={color}
					onChange={c => {
						setColor(c)
						setHexInput('')
					}}
				/>

				<View
					style={{
						flexDirection: 'row',
						gap: 8,
						marginTop: 8,
						marginBottom: 4,
					}}
				>
					<Button
						text="Pick custom color"
						variant="secondary"
						onPress={pickCustom}
					/>
				</View>
			</View>

			<TextInput
				label="Custom hex color"
				placeholder="#5865f2"
				value={hexInput}
				onChange={applyHex}
			/>
			<TextInput
				label="Note"
				placeholder="Add a note for this server..."
				value={note}
				onChange={setNoteText}
				multiline
			/>

			<View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
				<Button
					text="Save"
					variant="primary"
					onPress={() => {
						const trimmed = note.trim()
						if (!trimmed && color === DefaultTagColor) {
							ToastActionCreators.open('SERVER_NOTES_EMPTY', {
								text: 'Add a note or choose a color.',
								variant: 'critical',
							})
							return
						}
						onSave({ note: trimmed, color })
					}}
				/>
				{onDelete ? (
					<Button text="Delete note" variant="destructive" onPress={onDelete} />
				) : null}
				<Button text="Cancel" variant="secondary" onPress={onCancel} />
			</View>
		</TableRowGroup>
	)
}

function GuildPicker({
	onPick,
	onCancel,
}: {
	onPick: (id: string) => void
	onCancel: () => void
}) {
	const [query, setQuery] = useState('')
	const guilds = allGuilds().filter(g => {
		if (!query) return true
		const q = query.toLowerCase()
		return (g.name ?? '').toLowerCase().includes(q) || g.id.includes(q)
	})

	return (
		<TableRowGroup title="Choose a server">
			<TextInput
				label="Search"
				placeholder="Search by name or ID..."
				value={query}
				onChange={setQuery}
			/>
			<View style={{ maxHeight: 380 }}>
				<ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
					{guilds.slice(0, 150).map(g => (
						<TableRow
							key={g.id}
							label={g.name ?? g.id}
							subLabel={g.name ? g.id : undefined}
							onPress={() => onPick(g.id)}
							arrow
						/>
					))}
					{guilds.length === 0 ? (
						<View style={{ padding: 16 }}>
							<Text variant="text-sm/normal" style={{ opacity: 0.7 }}>
								No servers found.
							</Text>
						</View>
					) : null}
				</ScrollView>
			</View>
			<View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
				<Button text="Cancel" variant="secondary" onPress={onCancel} />
			</View>
		</TableRowGroup>
	)
}

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const settings = { ...DefaultSettings, ...storage.use() }
	const notes = settings.notes ?? {}
	const [editingId, setEditingId] = useState<string | null>(null)
	const [adding, setAdding] = useState(false)

	// If opened from server context menu, jump straight to editor
	useEffect(() => {
		const pending = storage.cache?.pendingGuildId
		if (pending) {
			setEditingId(pending)
			setAdding(false)
			setPendingGuildId(null)
		}
	}, [storage])

	const entries = Object.entries(notes).sort((a, b) =>
		guildName(a[0]).localeCompare(guildName(b[0])),
	)

	const save = (guildId: string, note: ServerNote) => {
		setNote(guildId, note)
		setEditingId(null)
		setAdding(false)
		ToastActionCreators.open('SERVER_NOTES_SAVED', {
			text: 'Server note saved.',
			variant: 'success',
		})
	}

	const remove = (guildId: string) => {
		setNote(guildId, null)
		setEditingId(null)
		ToastActionCreators.open('SERVER_NOTES_REMOVED', {
			text: 'Server note removed.',
			variant: 'default',
		})
	}

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				{!editingId && !adding ? (
					<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
						Add notes and color tags to servers to keep track of them.
					</Text>
				) : null}

				{editingId ? (
					<EditNote
						guildId={editingId}
						initial={notes[editingId]}
						onSave={note => save(editingId, note)}
						onCancel={() => {
							setEditingId(null)
							setAdding(false)
						}}
						onDelete={notes[editingId] ? () => remove(editingId) : undefined}
					/>
				) : adding ? (
					<GuildPicker
						onPick={id => {
							setAdding(false)
							setEditingId(id)
						}}
						onCancel={() => setAdding(false)}
					/>
				) : (
					<>
						<TableRowGroup title="Server notes">
							{entries.length === 0 ? (
								<View style={{ padding: 16 }}>
									<Text variant="text-sm/normal" style={{ opacity: 0.7 }}>
										No notes yet. Add one from here or from a server's menu.
									</Text>
								</View>
							) : (
								entries.map(([guildId, note]) => (
									<TableRow
										key={guildId}
										label={guildName(guildId)}
										subLabel={
											note.note
												? note.note.length > 70
													? `${note.note.slice(0, 70)}...`
													: note.note
												: `Tag: ${colorLabel(note.color)}`
										}
										icon={<ColorDot color={note.color} size={18} />}
										onPress={() => setEditingId(guildId)}
										arrow
									/>
								))
							)}
						</TableRowGroup>
						<View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
							<Button
								text="Add server note"
								variant="primary"
								onPress={() => setAdding(true)}
							/>
						</View>
						<View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
							<Text variant="text-xs/normal" style={{ opacity: 0.6 }}>
								Notes and tags are stored locally on this device.
							</Text>
						</View>
					</>
				)}
			</Page>
		</ScrollView>
	)
}
