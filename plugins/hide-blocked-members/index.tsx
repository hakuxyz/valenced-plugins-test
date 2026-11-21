import { getStore, Stores } from '@valenced/discord/flux'
import { JsonStorageUpdateMode } from '@valenced/json-storage'
import { instead } from '@valenced/patcher'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import type { Settings } from './shared'

type AnyFunction = (...args: any[]) => any
type Cleanup = (...fns: Array<() => unknown>) => void
type LooseInstead = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (args: any[], original: AnyFunction) => any,
) => () => void

const insteadLoose = instead as unknown as LooseInstead

let groupGeneration = 0
let findChannel: ((channelId: string) => any) | undefined

const channelCopies = new WeakMap<
	object,
	{
		generation: number
		recipients: unknown
		rawRecipients: unknown
		recipientIds: unknown
		copy: any
	}
>()

function currentSettings(storage: any): Settings {
	return { ...DefaultSettings, ...(storage.cache ?? {}) }
}

function relationshipStore(): any {
	try {
		return Stores.RelationshipStore
	} catch {
		return undefined
	}
}

function shouldHide(userId: string | undefined, storage: any): boolean {
	if (!userId) return false

	const settings = currentSettings(storage)
	const relationships = relationshipStore()
	if (!relationships) return false

	try {
		return Boolean(
			(settings.blocked && relationships.isBlocked?.(userId)) ||
				(settings.ignored && relationships.isIgnored?.(userId)),
		)
	} catch {
		return false
	}
}

function idOf(value: any): string | undefined {
	if (typeof value === 'string') return value
	if (typeof value?.id === 'string') return value.id
	if (typeof value?.userId === 'string') return value.userId
	if (typeof value?.user?.id === 'string') return value.user.id
	return undefined
}

function rowUserId(row: any): string | undefined {
	return (
		idOf(row?.user) ??
		idOf(row?.member?.user) ??
		idOf(row?.userId) ??
		idOf(row?.member?.userId) ??
		idOf(row)
	)
}

function isHeaderRow(row: any): boolean {
	if (!row || typeof row !== 'object') return false
	if (row.type === 1 || row.type === 'GROUP' || row.type === 'header') {
		return true
	}
	return (
		typeof row.count === 'number' && !row.user && !row.member && !row.userId
	)
}

function groupKey(value: any): string | undefined {
	const key =
		value?.group?.id ??
		value?.group?.key ??
		value?.id ??
		value?.key ??
		value?.title ??
		value?.name
	return typeof key === 'string' ? key : undefined
}

function adjustCount(row: any, removed: number) {
	if (!removed || typeof row?.count !== 'number') return row
	return { ...row, count: Math.max(0, row.count - removed) }
}

interface FilteredRows {
	rows: any[]
	removedByHeader: Map<object, number>
	removedByGroup: Map<string, number>
	totalRemoved: number
}

function filterRowsWithInfo(rows: any[], storage: any): FilteredRows {
	const removedByHeader = new Map<object, number>()
	const removedByGroup = new Map<string, number>()
	let lastHeader: any
	let totalRemoved = 0
	const kept: any[] = []

	for (const row of rows) {
		if (isHeaderRow(row)) {
			lastHeader = row
			kept.push(row)
			continue
		}

		const userId = rowUserId(row)
		if (!userId || !shouldHide(userId, storage)) {
			kept.push(row)
			continue
		}

		totalRemoved++
		if (lastHeader) {
			removedByHeader.set(
				lastHeader,
				(removedByHeader.get(lastHeader) ?? 0) + 1,
			)
		}
		const key = groupKey(lastHeader) ?? groupKey(row)
		if (key) removedByGroup.set(key, (removedByGroup.get(key) ?? 0) + 1)
	}

	return { rows: kept, removedByHeader, removedByGroup, totalRemoved }
}

function rowsWithAdjustedCounts(filtered: FilteredRows): any[] {
	return filtered.rows.map(row => {
		const removed = isHeaderRow(row)
			? (filtered.removedByHeader.get(row) ?? 0)
			: 0
		return adjustCount(row, removed)
	})
}

function filterRows(rows: any[], storage: any): any[] {
	const filtered = filterRowsWithInfo(rows, storage)
	if (!filtered.totalRemoved) return rows
	return rowsWithAdjustedCounts(filtered)
}

function filterMemberProps(_args: any[], props: any, storage: any) {
	if (!props || typeof props !== 'object' || !Array.isArray(props.rows)) {
		return props
	}

	const filtered = filterRowsWithInfo(props.rows, storage)
	if (!filtered.totalRemoved) return props

	const groups = Array.isArray(props.groups)
		? props.groups.map((group: any) =>
				adjustCount(
					group,
					filtered.removedByGroup.get(groupKey(group) ?? '') ?? 0,
				),
			)
		: props.groups

	return { ...props, rows: rowsWithAdjustedCounts(filtered), groups }
}

function filterChannelList(list: any, storage: any) {
	if (!Array.isArray(list)) return list
	const kept = list.filter(item => !shouldHide(idOf(item), storage))
	return kept.length === list.length ? list : kept
}

function copyChannel(
	channel: any,
	recipients: any,
	rawRecipients: any,
	recipientIds: any,
) {
	const copy = Object.create(Object.getPrototypeOf(channel))
	for (const key of Object.getOwnPropertyNames(channel)) {
		const descriptor = Object.getOwnPropertyDescriptor(channel, key)
		if (descriptor) Object.defineProperty(copy, key, descriptor)
	}

	const set = (key: string, value: any) => {
		if (value === undefined) return
		Object.defineProperty(copy, key, {
			value,
			writable: true,
			enumerable: true,
			configurable: true,
		})
	}

	set('recipients', recipients)
	set('rawRecipients', rawRecipients)
	set('recipientIds', recipientIds)
	return copy
}

function filterGroupChannel(channel: any, storage: any) {
	if (channel?.type !== 3) return channel

	const recipients = filterChannelList(channel.recipients, storage)
	const rawRecipients = filterChannelList(channel.rawRecipients, storage)
	const recipientIds = filterChannelList(channel.recipientIds, storage)
	const changed =
		recipients !== channel.recipients ||
		rawRecipients !== channel.rawRecipients ||
		recipientIds !== channel.recipientIds
	if (!changed) return channel

	const cached = channelCopies.get(channel)
	if (
		cached &&
		cached.generation === groupGeneration &&
		cached.recipients === channel.recipients &&
		cached.rawRecipients === channel.rawRecipients &&
		cached.recipientIds === channel.recipientIds
	) {
		return cached.copy
	}

	const copy = copyChannel(channel, recipients, rawRecipients, recipientIds)
	channelCopies.set(channel, {
		generation: groupGeneration,
		recipients: channel.recipients,
		rawRecipients: channel.rawRecipients,
		recipientIds: channel.recipientIds,
		copy,
	})
	return copy
}

function relationshipIds(relationships: any): string[] {
	if (!relationships) return []
	if (relationships instanceof Map) {
		return [...relationships.keys()].map(String)
	}
	return Object.keys(relationships)
}

function hiddenRelationshipIds(storage: any): string[] {
	const relationships = relationshipStore()
	if (!relationships) return []

	let ids: string[] = []
	try {
		ids = relationshipIds(relationships.getRelationships?.())
	} catch {}

	if (ids.length) return ids.filter(id => shouldHide(id, storage))

	const fallback: unknown[] = []
	try {
		fallback.push(...(relationships.getBlockedIDs?.() ?? []))
		fallback.push(...(relationships.getIgnoredIDs?.() ?? []))
	} catch {}
	return fallback
		.map(idOf)
		.filter((id): id is string => Boolean(id))
		.filter(id => shouldHide(id, storage))
}

function hiddenGuildMemberCount(guildId: string | undefined, storage: any) {
	if (typeof guildId !== 'string' || !guildId) return 0

	const members: any = (() => {
		try {
			return Stores.GuildMemberStore
		} catch {
			return undefined
		}
	})()

	let count = 0
	for (const userId of hiddenRelationshipIds(storage)) {
		try {
			const isMember =
				members?.isMember?.(guildId, userId) ??
				Boolean(members?.getMember?.(guildId, userId))
			if (isMember) count++
		} catch {}
	}
	return count
}

function hiddenChannelMemberCount(channelId: string | undefined, storage: any) {
	if (typeof channelId !== 'string' || !channelId) return 0

	let channel: any
	try {
		channel =
			findChannel?.(channelId) ??
			(Stores.ChannelStore as any)?.getChannel?.(channelId)
	} catch {
		return 0
	}
	if (channel?.type !== 3) return 0

	const list =
		channel.recipients ?? channel.rawRecipients ?? channel.recipientIds
	if (!Array.isArray(list)) return 0
	return list.filter(item => shouldHide(idOf(item), storage)).length
}

function patchMethod(
	cleanup: Cleanup,
	store: any,
	method: string,
	hook: (args: any[], result: any) => any,
) {
	if (typeof store?.[method] !== 'function') return
	cleanup(
		insteadLoose(store, method, (args, original) => {
			const result = original(...args)
			try {
				return hook(args, result)
			} catch {
				return result
			}
		}),
	)
}

function refreshMemberStores() {
	for (const name of [
		'ChannelMemberStore',
		'ChannelMemberCountStore',
		'GuildMemberCountStore',
	]) {
		try {
			const store = (Stores as any)[name]
			store?._changeCallbacks?.invokeAll?.()
			store?._reactChangeCallbacks?.invokeAll?.()
		} catch {}
	}
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start({ cleanup, jsonStorage: storage, plugin }) {
		cleanup(
			storage.subscribe((_, mode) => {
				if (mode !== JsonStorageUpdateMode.Load) plugin.requireReload()
			}),
		)

		cleanup(
			getStore<any>('RelationshipStore', store => {
				const listener = () => {
					groupGeneration++
					refreshMemberStores()
				}
				store.addChangeListener(listener)
				cleanup(() => store.removeChangeListener(listener))
			}),
		)

		cleanup(
			getStore<any>('ChannelMemberStore', store => {
				patchMethod(cleanup, store, 'getProps', (args, result) =>
					filterMemberProps(args, result, storage),
				)
				patchMethod(cleanup, store, 'getRows', (_args, result) =>
					Array.isArray(result) ? filterRows(result, storage) : result,
				)
			}),
		)

		cleanup(
			getStore<any>('ChannelStore', store => {
				const getChannel = store.getChannel?.bind(store)
				if (!getChannel) return
				findChannel = getChannel
				patchMethod(cleanup, store, 'getChannel', (_args, result) =>
					filterGroupChannel(result, storage),
				)
			}),
		)

		cleanup(
			getStore<any>('GuildMemberCountStore', store => {
				patchMethod(cleanup, store, 'getMemberCount', (args, result) =>
					typeof result === 'number'
						? Math.max(0, result - hiddenGuildMemberCount(args[0], storage))
						: result,
				)
			}),
		)

		cleanup(
			getStore<any>('ChannelMemberCountStore', store => {
				patchMethod(cleanup, store, 'getMemberCount', (args, result) =>
					typeof result === 'number'
						? Math.max(0, result - hiddenChannelMemberCount(args[0], storage))
						: result,
				)
			}),
		)
	},
	SettingsComponent,
})
