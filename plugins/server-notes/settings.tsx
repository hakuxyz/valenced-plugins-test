import Page from '@valenced/components/Page'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import {
	DefaultSettings,
	DefaultTagColor,
	TagColorNames,
	TagColors,
	tagColorHex,
} from './shared'
import { setNote } from './state'
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

function ColorDot({ color, size = 14 }: { color: string; size?: number }) {
	return (
		<View
			style={{
				width: size,
				height: size,
				borderRadius: size / 2,
				backgroundColor: color,
				borderWidth: 1,
				borderColor: 'rgba(255,255,255,0.15)',
			}}
		/>
	)
}

function ColorPicker({
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
			{Object.entries(TagColors).map(([key, hex]) => {
				const selected = key === value
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
							alignItems: 'center',
							justifyContent: 'center',
						}}
						accessibilityLabel={TagColorNames[key] ?? key}
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
	const name = guildName(guildId)

	return (
		<TableRowGroup title={initial ? 'Edit note' : 'Add note'}>
			<View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
				<Text variant="text-md/semibold" style={{ marginBottom: 4 }}>
					{name}
				</Text>
				<Text
					variant="text-sm/normal"
					style={{ opacity: 0.7, marginBottom: 8 }}
				>
					{guildId}
				</Text>
				<Text variant="text-sm/semibold" style={{ marginBottom: 4 }}>
					Tag color
				</Text>
				<ColorPicker value={color} onChange={setColor} />
				<Text
					variant="text-sm/normal"
					style={{ marginBottom: 6, opacity: 0.8 }}
				>
					{TagColorNames[color] ?? color}
				</Text>
			</View>
			<TextInput
				label="Note"
				placeholder="Why did you join/leave this server?"
				value={note}
				onChange={setNoteText}
				multiline
			/>
			<View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
				<Button
					text="Save"
					variant="primary"
					onPress={() => {
						const trimmed = note.trim()
						if (!trimmed && color === DefaultTagColor) {
							ToastActionCreators.open('SERVER_NOTES_EMPTY', {
								text: 'Add a note or pick a color.',
								variant: 'critical',
							})
							return
						}
						onSave({ note: trimmed, color })
					}}
				/>
				{onDelete ? (
					<Button text="Delete" variant="destructive" onPress={onDelete} />
				) : null}
				<Button text="Cancel" variant="secondary" onPress={onCancel} />
			</View>
		</TableRowGroup>
	)
}

function GuildPicker({
	onPick,
	onCancel,
	existingIds,
}: {
	onPick: (id: string) => void
	onCancel: () => void
	existingIds: Set<string>
}) {
	const [query, setQuery] = useState('')
	const guilds = allGuilds().filter(g => {
		if (existingIds.has(g.id)) return false
		if (!query) return true
		const q = query.toLowerCase()
		return (g.name ?? '').toLowerCase().includes(q) || g.id.includes(q)
	})

	return (
		<TableRowGroup title="Pick a server">
			<TextInput
				label="Search"
				placeholder="Search servers..."
				value={query}
				onChange={setQuery}
			/>
			<View style={{ maxHeight: 360 }}>
				<ScrollView nestedScrollEnabled>
					{guilds.slice(0, 100).map(g => (
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

	const entries = Object.entries(notes).sort((a, b) =>
		guildName(a[0]).localeCompare(guildName(b[0])),
	)

	const save = (guildId: string, note: ServerNote) => {
		setNote(guildId, note)
		setEditingId(null)
		setAdding(false)
		ToastActionCreators.open('SERVER_NOTES_SAVED', {
			text: 'Note saved.',
			variant: 'success',
		})
	}

	const remove = (guildId: string) => {
		setNote(guildId, null)
		setEditingId(null)
		ToastActionCreators.open('SERVER_NOTES_REMOVED', {
			text: 'Note removed.',
			variant: 'default',
		})
	}

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
					Add notes and color tags to servers so you remember why you joined -
					or why you left.
				</Text>

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
						existingIds={new Set(Object.keys(notes))}
						onPick={id => {
							setAdding(false)
							setEditingId(id)
						}}
						onCancel={() => setAdding(false)}
					/>
				) : (
					<>
						<TableRowGroup title="Notes">
							{entries.length === 0 ? (
								<View style={{ padding: 16 }}>
									<Text variant="text-sm/normal" style={{ opacity: 0.7 }}>
										No notes yet. Tap "Add note" to get started.
									</Text>
								</View>
							) : (
								entries.map(([guildId, note]) => (
									<TableRow
										key={guildId}
										label={guildName(guildId)}
										subLabel={
											note.note
												? note.note.length > 60
													? `${note.note.slice(0, 60)}...`
													: note.note
												: `Tag: ${TagColorNames[note.color] ?? note.color}`
										}
										icon={
											<ColorDot color={tagColorHex(note.color)} size={18} />
										}
										onPress={() => setEditingId(guildId)}
										arrow
									/>
								))
							)}
						</TableRowGroup>
						<View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
							<Button
								text="Add note"
								variant="primary"
								onPress={() => setAdding(true)}
							/>
						</View>
						<View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
							<Text variant="text-xs/normal" style={{ opacity: 0.6 }}>
								Notes are stored locally on this device.
							</Text>
						</View>
					</>
				)}
			</Page>
		</ScrollView>
	)
}
