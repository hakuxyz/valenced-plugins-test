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
		return { ...DefaultSettings, ...(storage?.cache ?? {}) }
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
		const guild = storeByName('GuildStore')?.getGuild?.(guildId)
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

export default plugin({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},

	init({ cleanup: clean, jsonStorage: storage }) {
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
							(action.type === 'CHANNEL_SELECT' ||
								action.type === 'GUILD_SUBSCRIPTIONS' ||
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
	},

	SettingsComponent,
})
