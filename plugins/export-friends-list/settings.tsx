import Page from '@valenced/components/Page'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { View } from 'react-native'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'

const { TableRow, TableRowGroup, Text } = Design

type Props = ComponentProps<PluginSettingsComponent<Record<string, never>>>

interface RelationshipStoreLike {
	getRelationships?: () => Record<string, number> | Map<string, number>
	getFriendIDs?: () => string[]
}

interface UserLike {
	id?: string
	username?: string
	globalName?: string | null
	discriminator?: string
}

interface UserStoreLike {
	getUser?: (id: string) => UserLike | undefined
}

type RelationshipType = 1 | 2 | 3 | 4

interface ExportEntry {
	id: string
	username?: string
	globalName?: string | null
	discriminator?: string
	tag: string
}

interface ExportData {
	friends: ExportEntry[]
	blocked: ExportEntry[]
	incomingRequests: ExportEntry[]
	outgoingRequests: ExportEntry[]
}

function getRelationshipStore(): RelationshipStoreLike | undefined {
	return (Stores as Record<string, unknown>).RelationshipStore as
		| RelationshipStoreLike
		| undefined
}

function getUserStore(): UserStoreLike | undefined {
	return (Stores as Record<string, unknown>).UserStore as
		| UserStoreLike
		| undefined
}

function tagFor(user: UserLike | undefined, id: string): string {
	if (!user) return id
	const username = user.username ?? id
	const discriminator = user.discriminator
	if (
		discriminator &&
		discriminator !== '0' &&
		discriminator !== '0000' &&
		discriminator !== '00000'
	) {
		return `${username}#${discriminator}`
	}
	return username
}

function toEntry(
	id: string,
	userStore: UserStoreLike | undefined,
): ExportEntry {
	const user = userStore?.getUser?.(id)
	const entry: ExportEntry = {
		id,
		tag: tagFor(user, id),
	}
	if (user?.username) entry.username = user.username
	if (user?.globalName != null) entry.globalName = user.globalName
	if (user?.discriminator) entry.discriminator = user.discriminator
	return entry
}

function collectRelationships(): ExportData {
	const relStore = getRelationshipStore()
	const userStore = getUserStore()

	const result: ExportData = {
		friends: [],
		blocked: [],
		incomingRequests: [],
		outgoingRequests: [],
	}

	const rels = relStore?.getRelationships?.()
	const add = (id: string, type: number) => {
		const entry = toEntry(id, userStore)
		switch (type as RelationshipType) {
			case 1:
				result.friends.push(entry)
				break
			case 2:
				result.blocked.push(entry)
				break
			case 3:
				result.incomingRequests.push(entry)
				break
			case 4:
				result.outgoingRequests.push(entry)
				break
		}
	}

	if (rels instanceof Map) {
		for (const [id, type] of rels.entries()) add(String(id), Number(type))
	} else if (rels && typeof rels === 'object') {
		for (const [id, type] of Object.entries(rels)) add(id, Number(type))
	}

	const byTag = (a: ExportEntry, b: ExportEntry) =>
		a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' })
	result.friends.sort(byTag)
	result.blocked.sort(byTag)
	result.incomingRequests.sort(byTag)
	result.outgoingRequests.sort(byTag)

	return result
}

function toast(text: string, variant: 'default' | 'critical' = 'default') {
	try {
		ToastActionCreators.open(
			`HAKUXYZ_EXPORT_FRIENDS_${Date.now()}_${Math.random()}`,
			{ text, variant },
		)
	} catch {}
}

function copyText(label: string, text: string) {
	try {
		Clipboard.setString(text)
		toast(`${label} copied to clipboard.`)
	} catch {
		toast('Clipboard is unavailable.', 'critical')
	}
}

function formatList(entries: ExportEntry[]): string {
	return entries.map(e => `${e.tag} (${e.id})`).join('\n')
}

export default function SettingsComponent(_props: Props) {
	const data = collectRelationships()
	const total =
		data.friends.length +
		data.blocked.length +
		data.incomingRequests.length +
		data.outgoingRequests.length

	const exportAllJson = () => {
		const payload = {
			exportedAt: new Date().toISOString(),
			counts: {
				friends: data.friends.length,
				blocked: data.blocked.length,
				incomingRequests: data.incomingRequests.length,
				outgoingRequests: data.outgoingRequests.length,
			},
			friends: data.friends,
			blocked: data.blocked,
			incomingRequests: data.incomingRequests,
			outgoingRequests: data.outgoingRequests,
		}
		copyText('All relationships (JSON)', JSON.stringify(payload, null, 2))
	}

	return (
		<Page>
			<View style={{ gap: 12, paddingBottom: 24 }}>
				<TableRowGroup title="Export">
					<TableRow
						label="Copy all relationships (JSON)"
						subLabel={`${total} total entries`}
						onPress={exportAllJson}
						arrow
					/>
					<TableRow
						label="Copy friends list"
						subLabel={`${data.friends.length} friends`}
						onPress={() => copyText('Friends list', formatList(data.friends))}
						arrow
					/>
					<TableRow
						label="Copy blocked users"
						subLabel={`${data.blocked.length} blocked`}
						onPress={() => copyText('Blocked users', formatList(data.blocked))}
						arrow
					/>
					<TableRow
						label="Copy incoming requests"
						subLabel={`${data.incomingRequests.length} incoming`}
						onPress={() =>
							copyText('Incoming requests', formatList(data.incomingRequests))
						}
						arrow
					/>
					<TableRow
						label="Copy outgoing requests"
						subLabel={`${data.outgoingRequests.length} outgoing`}
						onPress={() =>
							copyText('Outgoing requests', formatList(data.outgoingRequests))
						}
						arrow
					/>
				</TableRowGroup>

				<TableRowGroup title="Info">
					<View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 6 }}>
						<Text variant="text-sm/normal">Friends: {data.friends.length}</Text>
						<Text variant="text-sm/normal">Blocked: {data.blocked.length}</Text>
						<Text variant="text-sm/normal">
							Incoming requests: {data.incomingRequests.length}
						</Text>
						<Text variant="text-sm/normal">
							Outgoing requests: {data.outgoingRequests.length}
						</Text>
						<Text
							variant="text-xs/normal"
							style={{ opacity: 0.7, marginTop: 4 }}
						>
							Exports the currently loaded relationship data to your clipboard.
						</Text>
					</View>
				</TableRowGroup>
			</View>
		</Page>
	)
}
