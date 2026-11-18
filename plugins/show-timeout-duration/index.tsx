import { Stores } from '@valenced/discord/flux'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { instead } from '@valenced/patcher'
import SettingsComponent from './settings'
import { DefaultSettings, formatRemaining, toTimestamp } from './shared'
import {
	currentSettings,
	setStorage,
	stopTicker,
	trackMessage,
	untrackMessage,
} from './state'
import type { Settings, TimeoutInfo } from './shared'

const CreateMessageContent =
	'modules/messages/native/renderer/createMessageContent.tsx'

interface MessageLike {
	id?: string
	messageId?: string
	channelId?: string
	channel_id?: string
	channel?: { id?: string }
	guildId?: string
	guild_id?: string
	authorId?: string
	author?: { id?: string; communicationDisabledUntil?: unknown }
	user?: { id?: string }
	member?: { communicationDisabledUntil?: unknown }
	communicationDisabledUntil?: unknown
}

interface ContentLike {
	username?: unknown
}

function channelGuildId(channelId: string | undefined): string | undefined {
	if (!channelId) return undefined
	try {
		const channel = (Stores as any).ChannelStore?.getChannel?.(channelId)
		return channel?.guild_id ?? undefined
	} catch {
		return undefined
	}
}

function findTimeout(
	message: MessageLike | undefined,
): TimeoutInfo | undefined {
	if (!message || typeof message !== 'object') return undefined

	const id = message.id ?? message.messageId
	const channelId =
		message.channelId ?? message.channel_id ?? message.channel?.id
	const authorId = message.authorId ?? message.author?.id ?? message.user?.id
	if (!authorId) {
		untrackMessage(id)
		return undefined
	}

	const guildId =
		message.guildId ?? message.guild_id ?? channelGuildId(channelId)
	if (!guildId) {
		untrackMessage(id)
		return undefined
	}

	let member: { communicationDisabledUntil?: unknown } | undefined
	try {
		member = (Stores as any).GuildMemberStore?.getMember?.(guildId, authorId)
	} catch {}

	const deadline = toTimestamp(
		member?.communicationDisabledUntil ??
			message.member?.communicationDisabledUntil ??
			message.author?.communicationDisabledUntil ??
			message.communicationDisabledUntil,
	)

	if (!Number.isFinite(deadline) || deadline <= Date.now()) {
		untrackMessage(id)
		return undefined
	}

	return { id, channelId, guildId, authorId, deadline }
}

function applyTimeout(
	content: ContentLike | undefined | null,
	message: MessageLike | undefined,
): ContentLike | undefined | null {
	if (!content || typeof content.username !== 'string') return content

	const info = findTimeout(message)
	if (!info) return content

	const remaining = info.deadline - Date.now()
	if (remaining <= 0) {
		untrackMessage(info.id)
		return content
	}

	const settings = currentSettings()
	const duration = formatRemaining(remaining, settings.showSeconds)
	const suffix = settings.showLabel ? `${duration} left` : duration
	if (content.username.includes(suffix)) return content

	trackMessage(info.id, info.channelId, info.guildId, info.deadline)
	return { ...content, username: `${content.username} · ${suffix}` }
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},

	start({ cleanup, jsonStorage }) {
		setStorage(jsonStorage)
		cleanup(stopTicker)

		cleanup(
			getModuleWithImportedPath<{ default: (...args: any[]) => any }>(
				CreateMessageContent,
				ns => {
					if (typeof ns?.default !== 'function') return
					cleanup(
						instead(ns, 'default', function (args: any[], original: any) {
							const ret = Reflect.apply(original, this, args) as
								| ContentLike
								| undefined
							try {
								const message = args?.[0]?.message ?? args?.[0]
								return applyTimeout(ret, message as MessageLike | undefined)
							} catch {
								return ret
							}
						}),
					)
				},
			),
		)
	},

	SettingsComponent,
})
