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
}

interface UserLike {
	id?: string
	username?: string
	discriminator?: string
}

interface UserStoreLike {
	getUser?: (id: string) => UserLike | undefined
}

interface ContactList {
	friendsAdded: string[]
	blockedUsers: string[]
	incomingFriendRequests: string[]
	outgoingFriendRequests: string[]
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

function getUsername(id: string, userStore: UserStoreLike | undefined): string {
	const user = userStore?.getUser?.(id)
	if (!user) return id

	const username = user.username ?? id
	const discriminator = user.discriminator
	if (discriminator && discriminator !== '0') {
		return `${username}#${discriminator}`
	}
	return username
}

function getContacts(): ContactList {
	const relStore = getRelationshipStore()
	const userStore = getUserStore()
	const rels = relStore?.getRelationships?.()

	const contactList: ContactList = {
		friendsAdded: [],
		blockedUsers: [],
		incomingFriendRequests: [],
		outgoingFriendRequests: [],
	}

	const add = (id: string, type: number) => {
		const name = getUsername(id, userStore)
		switch (type) {
			case 1:
				contactList.friendsAdded.push(name)
				break
			case 2:
				contactList.blockedUsers.push(name)
				break
			case 3:
				contactList.incomingFriendRequests.push(name)
				break
			case 4:
				contactList.outgoingFriendRequests.push(name)
				break
		}
	}

	if (rels instanceof Map) {
		for (const [id, type] of rels.entries()) add(String(id), Number(type))
	} else if (rels && typeof rels === 'object') {
		for (const [id, type] of Object.entries(rels)) add(id, Number(type))
	}

	const byName = (a: string, b: string) =>
		a.localeCompare(b, undefined, { sensitivity: 'base' })
	contactList.friendsAdded.sort(byName)
	contactList.blockedUsers.sort(byName)
	contactList.incomingFriendRequests.sort(byName)
	contactList.outgoingFriendRequests.sort(byName)

	return contactList
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

export default function SettingsComponent(_props: Props) {
	const contactList = getContacts()
	const total =
		contactList.friendsAdded.length +
		contactList.blockedUsers.length +
		contactList.incomingFriendRequests.length +
		contactList.outgoingFriendRequests.length

	const copyContactsJson = () => {
		copyText('Contacts', JSON.stringify(contactList))
	}

	const copyList = (label: string, list: string[]) => {
		copyText(label, list.join('\n'))
	}

	return (
		<Page>
			<View style={{ gap: 12, paddingBottom: 24 }}>
				<TableRowGroup title="Export">
					<TableRow
						label="Copy contacts (JSON)"
						subLabel={`${total} total entries`}
						onPress={copyContactsJson}
						arrow
					/>
					<TableRow
						label="Copy friends list"
						subLabel={`${contactList.friendsAdded.length} friends`}
						onPress={() => copyList('Friends list', contactList.friendsAdded)}
						arrow
					/>
					<TableRow
						label="Copy blocked users"
						subLabel={`${contactList.blockedUsers.length} blocked`}
						onPress={() => copyList('Blocked users', contactList.blockedUsers)}
						arrow
					/>
					<TableRow
						label="Copy incoming friend requests"
						subLabel={`${contactList.incomingFriendRequests.length} incoming`}
						onPress={() =>
							copyList(
								'Incoming friend requests',
								contactList.incomingFriendRequests,
							)
						}
						arrow
					/>
					<TableRow
						label="Copy outgoing friend requests"
						subLabel={`${contactList.outgoingFriendRequests.length} outgoing`}
						onPress={() =>
							copyList(
								'Outgoing friend requests',
								contactList.outgoingFriendRequests,
							)
						}
						arrow
					/>
				</TableRowGroup>

				<TableRowGroup title="Info">
					<View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 6 }}>
						<Text variant="text-sm/normal">
							Friends: {contactList.friendsAdded.length}
						</Text>
						<Text variant="text-sm/normal">
							Blocked: {contactList.blockedUsers.length}
						</Text>
						<Text variant="text-sm/normal">
							Incoming requests: {contactList.incomingFriendRequests.length}
						</Text>
						<Text variant="text-sm/normal">
							Outgoing requests: {contactList.outgoingFriendRequests.length}
						</Text>
						<Text
							variant="text-xs/normal"
							style={{ opacity: 0.7, marginTop: 4 }}
						>
							Exports relationship data from the currently loaded stores to your
							clipboard. The JSON export uses the same format as Equicord
							(friendsAdded, blockedUsers, incomingFriendRequests,
							outgoingFriendRequests).
						</Text>
					</View>
				</TableRowGroup>
			</View>
		</Page>
	)
}
