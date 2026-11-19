import { Dispatcher } from '@valenced/discord/common/flux'
import { Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { before } from '@valenced/patcher'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import type { AnyFunction } from '@valenced/utils/types'
import type { Settings } from './shared'

type Cleanup = (...fns: Array<() => unknown>) => void

type LooseBefore = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (args: any[]) => any,
) => () => void

const beforeLoose = before as unknown as LooseBefore

const requestedGuilds = new Set<string>()
let requestMembersFn:
	| ((guildId: string, query?: string, limit?: number) => void)
	| undefined
let requestMembersSearched = false

function currentSettings(storage: any): Settings {
	try {
		const cached =
			storage?.cache ??
			(typeof storage?.get === 'function' ? storage.get() : undefined) ??
			storage?.data ??
			{}
		return { ...DefaultSettings, ...cached }
	} catch {
		return DefaultSettings
	}
}

function storeByName(name: string): Record<string, any> | undefined {
	try {
		return (Stores as unknown as Record<string, Record<string, any>>)[name]
	} catch {
		return undefined
	}
}

function getGuild(guildId: string): any {
	if (!guildId) return undefined
	try {
		return storeByName('GuildStore')?.getGuild?.(guildId)
	} catch {
		return undefined
	}
}

function guildIdFromAction(action: any): string | undefined {
	if (!action || typeof action !== 'object') return undefined
	if (typeof action.guildId === 'string' && action.guildId)
		return action.guildId
	if (typeof action.guild_id === 'string' && action.guild_id)
		return action.guild_id
	if (typeof action.channel?.guild_id === 'string' && action.channel.guild_id)
		return action.channel.guild_id

	const subs = action.subscriptions
	if (Array.isArray(subs)) {
		for (const sub of subs) {
			const id = sub?.guild_id ?? sub?.guildId
			if (typeof id === 'string' && id) return id
		}
	} else if (subs && typeof subs === 'object') {
		for (const key of Object.keys(subs)) {
			if (/^\d+$/.test(key)) return key
			const id = subs[key]?.guild_id ?? subs[key]?.guildId
			if (typeof id === 'string' && id) return id
		}
	}

	return undefined
}

function isLargeOrUnknownGuild(guildId: string): boolean {
	if (!guildId) return false
	try {
		const guild = getGuild(guildId)
		if (!guild) return true
		const count = Number(guild.memberCount ?? guild.approximateMemberCount ?? 0)
		if (count >= 1000) return true
		if (guild.large === true) return true
		return false
	} catch {
		return true
	}
}

function findRequestMembers(): void {
	if (requestMembersFn || requestMembersSearched) return
	requestMembersSearched = true
	try {
		getModules(withProps('requestMembers'), (module: any) => {
			try {
				if (typeof module?.requestMembers !== 'function') return
				requestMembersFn = (guildId: string, query = '', limit = 0) => {
					try {
						module.requestMembers(guildId, query, limit)
						return
					} catch {}
					try {
						module.requestMembers({ guildId, query, limit, presences: true })
						return
					} catch {}
					try {
						module.requestMembers({
							guildIds: [guildId],
							query,
							limit,
							presences: true,
						})
					} catch {}
				}
			} catch {}
		})
	} catch {}
}

function requestAllMembers(guildId: string): void {
	if (!guildId || requestedGuilds.has(guildId)) return
	requestedGuilds.add(guildId)

	try {
		findRequestMembers()
		requestMembersFn?.(guildId, '', 0)
	} catch {}

	// Best-effort fallbacks for builds where the action shape differs.
	try {
		Dispatcher.dispatch({
			type: 'GUILD_MEMBERS_REQUEST',
			guildId,
			query: '',
			limit: 0,
			presences: true,
		} as any)
	} catch {}
	try {
		Dispatcher.dispatch({
			type: 'GUILD_MEMBERS_REQUEST',
			guildIds: [guildId],
			query: '',
			limit: 0,
			presences: true,
		} as any)
	} catch {}
}

function maybeRequestAllMembers(
	guildId: string | undefined,
	settings: Settings,
): void {
	if (!settings.showAllMembers || !guildId) return
	if (!isLargeOrUnknownGuild(guildId)) return
	requestAllMembers(guildId)
}

function rangeKey(range: [number, number]): string {
	return `${range[0]}:${range[1]}`
}

function mergeRanges(
	existing: [number, number][],
	wanted: [number, number][],
): [number, number][] {
	const out: [number, number][] = []
	const seen = new Set<string>()
	for (const range of [...existing, ...wanted]) {
		if (!Array.isArray(range) || range.length < 2) continue
		const start = Number(range[0])
		const end = Number(range[1])
		if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
			continue
		const normalized: [number, number] = [
			Math.max(0, Math.floor(start)),
			Math.floor(end),
		]
		const key = rangeKey(normalized)
		if (seen.has(key)) continue
		seen.add(key)
		out.push(normalized)
	}
	return out.sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

function buildRequestedRanges(
	current: [number, number][],
	guildId: string,
): [number, number][] {
	const guild = getGuild(guildId)
	const memberCount = Number(
		guild?.memberCount ?? guild?.approximateMemberCount ?? 0,
	)
	const maxEnd =
		Number.isFinite(memberCount) && memberCount > 0 ? memberCount : 1200

	let highest = 99
	for (const range of current) {
		if (Array.isArray(range) && Number.isFinite(range[1])) {
			highest = Math.max(highest, Number(range[1]))
		}
	}

	// Keep the client's requested/visible ranges and prefetch a bit ahead so
	// members can load progressively while scrolling, instead of requesting
	// the entire guild list in one go.
	const target = Math.min(maxEnd, Math.max(highest + 300, 399))
	const wanted: [number, number][] = [[0, 99]]
	for (let start = 100; start <= target; start += 100) {
		wanted.push([start, start + 99])
	}

	return mergeRanges(current, wanted)
}

function augmentSubscriptionRangesForGuild(
	subscription: any,
	guildId: string,
): void {
	if (!subscription || typeof subscription !== 'object') return
	const channels = subscription.channels
	if (!channels || typeof channels !== 'object') return

	for (const channelId of Object.keys(channels)) {
		const value = channels[channelId]
		if (Array.isArray(value)) {
			channels[channelId] = buildRequestedRanges(
				value as [number, number][],
				guildId,
			)
			continue
		}
		if (value && typeof value === 'object' && Array.isArray(value.ranges)) {
			value.ranges = buildRequestedRanges(
				value.ranges as [number, number][],
				guildId,
			)
		}
	}
}

function augmentSubscriptionsAction(action: any, settings: Settings): void {
	if (!settings.showAllMembers || !action || typeof action !== 'object') return
	const subs = action.subscriptions
	if (!subs || typeof subs !== 'object' || Array.isArray(subs)) return

	for (const guildId of Object.keys(subs)) {
		if (!/^\d+$/.test(guildId)) continue
		if (!isLargeOrUnknownGuild(guildId)) continue
		augmentSubscriptionRangesForGuild(subs[guildId], guildId)
	}
}

function bootstrap({ cleanup: clean, jsonStorage: storage }: any) {
	const cleanup = clean as Cleanup

	try {
		cleanup(
			beforeLoose(Dispatcher as any, 'dispatch', (args: any[]) => {
				try {
					const action = args?.[0]
					if (!action || typeof action !== 'object') return args

					const settings = currentSettings(storage)

					if (action.type === 'GUILD_MEMBER_LIST_UPDATE') {
						maybeRequestAllMembers(guildIdFromAction(action), settings)
						if (settings.freezeMemberList) {
							args[0] = { type: 'HAKUXYZ_FULL_MEMBER_LIST_BLOCKED' }
							return args
						}
					}

					if (
						settings.showAllMembers &&
						action.type === 'GUILD_SUBSCRIPTIONS'
					) {
						augmentSubscriptionsAction(action, settings)
						maybeRequestAllMembers(guildIdFromAction(action), settings)
					}

					if (
						settings.showAllMembers &&
						(action.type === 'CHANNEL_SELECT' ||
							action.type === 'GUILD_SUBSCRIPTIONS_CHANNEL' ||
							action.type === 'GUILD_SUBSCRIPTIONS_FLUSH')
					) {
						maybeRequestAllMembers(guildIdFromAction(action), settings)
					}
				} catch {}
				return args
			}),
		)
	} catch {}

	cleanup(() => {
		requestedGuilds.clear()
		requestMembersFn = undefined
		requestMembersSearched = false
	})
}

export default plugin({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},

	init(ctx: any) {
		bootstrap(ctx)
	},

	start(ctx: any) {
		bootstrap(ctx)
	},

	settings: SettingsComponent,
	SettingsComponent,
})
