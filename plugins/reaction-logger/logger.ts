import { Dispatcher } from '@valenced/discord/common/flux'
import { onFluxEventDispatched } from '@valenced/discord/flux'
import { emojiKey, logKey, ReactionType, reactionKey } from './shared'
import type {
	LoggedReaction,
	ReactionAction,
	ReactionData,
	ReactionEmoji,
} from './shared'

/** All reactions seen per message, used to recover data before Discord removes it. */
const known = new Map<string, Map<string, ReactionData>>()

/** Deleted reactions we keep visible, per message. */
const logs = new Map<string, Map<string, LoggedReaction>>()

/** channelId for messages we have seen, used to force a row refresh. */
const channels = new Map<string, string>()

/** Messages whose events we trigger, so we do not log our own refresh. */
const bypassed = new Set<string>()

export function getDeletedReactions(messageId: string): LoggedReaction[] {
	const map = logs.get(messageId)
	return map ? [...map.values()] : []
}

/** Removers recorded for one emoji, newest last. */
export function getRemovers(
	messageId: string,
	emoji: ReactionEmoji | undefined,
	type: number,
): LoggedReaction[] {
	if (!emoji) return []
	return getDeletedReactions(messageId).filter(
		entry =>
			entry.type === type && emojiKey(entry.reaction.emoji) === emojiKey(emoji),
	)
}

/** Remember every reaction the row generator shows for a message. */
export function recordMessage(
	messageId: string,
	channelId: string | undefined,
	reactions: ReactionData[],
): void {
	if (channelId) channels.set(messageId, channelId)

	let seen = known.get(messageId)
	if (!seen) known.set(messageId, (seen = new Map()))

	for (const reaction of reactions) {
		const normal = reaction.count ?? 0
		const burst = reaction.burstCount ?? reaction.burst_count ?? 0
		const key = `${messageId}:${emojiKey(reaction.emoji)}`

		// Only positive counts are real. A zero count can be a bridge placeholder.
		if (normal > 0)
			seen.set(
				reactionKey(messageId, reaction.emoji, ReactionType.Normal),
				reaction,
			)
		if (burst > 0)
			seen.set(
				reactionKey(messageId, reaction.emoji, ReactionType.Burst),
				reaction,
			)
		if (
			reaction.count === undefined &&
			reaction.burstCount === undefined &&
			reaction.burst_count === undefined
		) {
			seen.set(`${key}:${ReactionType.Normal}`, reaction)
			seen.set(`${key}:${ReactionType.Burst}`, reaction)
		}
	}
}

/** Forget one user's removal when that user reacts again. */
function forget(
	messageId: string,
	emoji: ReactionEmoji | undefined,
	type: number,
	userId: string | undefined,
): boolean {
	if (!emoji) return false
	const map = logs.get(messageId)
	if (!map?.size) return false

	let changed = map.delete(logKey(messageId, emoji, type, userId))
	if (userId) changed = map.delete(logKey(messageId, emoji, type)) || changed
	if (!map.size) logs.delete(messageId)
	return changed
}

function remember(
	messageId: string,
	emoji: ReactionEmoji | undefined,
	type: number,
	userId?: string,
): boolean {
	if (!emoji) return false
	const key = reactionKey(messageId, emoji, type)
	const reaction = known.get(messageId)?.get(key)
	if (!reaction) return false

	let map = logs.get(messageId)
	if (!map) logs.set(messageId, (map = new Map()))
	map.set(logKey(messageId, emoji, type, userId), {
		reaction: { ...reaction },
		type,
		deletedAt: Date.now(),
		userId,
	})
	return true
}

function rerender(messageId: string): void {
	if (bypassed.has(messageId)) return
	const channelId = channels.get(messageId)
	if (!channelId) return

	// The store has not processed the removal while this Flux event dispatches.
	// Defer so the regenerated row sees the reaction actually gone.
	Promise.resolve().then(() => {
		if (bypassed.has(messageId)) return
		bypassed.add(messageId)
		try {
			Dispatcher.dispatch({
				type: 'MESSAGE_UPDATE',
				guildId: undefined,
				message: { id: messageId, channel_id: channelId },
			})
		} finally {
			bypassed.delete(messageId)
		}
	})
}

export function clearLogs(): void {
	known.clear()
	logs.clear()
	channels.clear()
	bypassed.clear()
}

export function interceptReactions() {
	return [
		onFluxEventDispatched<ReactionAction>('MESSAGE_REACTION_ADD', payload => {
			if (!payload.messageId) return payload
			if (
				forget(
					payload.messageId,
					payload.emoji,
					payload.reactionType ?? 0,
					payload.userId,
				)
			)
				rerender(payload.messageId)
			return payload
		}),
		onFluxEventDispatched<ReactionAction>(
			'MESSAGE_REACTION_REMOVE',
			payload => {
				if (!payload.messageId) return payload
				const type = payload.reactionType ?? 0
				if (remember(payload.messageId, payload.emoji, type, payload.userId))
					rerender(payload.messageId)
				return payload
			},
		),
		onFluxEventDispatched<ReactionAction>(
			'MESSAGE_REACTION_REMOVE_EMOJI',
			payload => {
				if (!payload.messageId) return payload
				let changed = remember(payload.messageId, payload.emoji, 0)
				changed = remember(payload.messageId, payload.emoji, 1) || changed
				if (changed) rerender(payload.messageId)
				return payload
			},
		),
		onFluxEventDispatched<ReactionAction>(
			'MESSAGE_REACTION_REMOVE_ALL',
			payload => {
				if (!payload.messageId) return payload
				const seen = known.get(payload.messageId)
				if (!seen) return payload

				let map = logs.get(payload.messageId)
				if (!map) logs.set(payload.messageId, (map = new Map()))
				for (const [key, reaction] of seen) {
					if (!map.has(key))
						map.set(key, {
							reaction: { ...reaction },
							type: key.split(':').at(-2) === '1' ? 1 : 0,
							deletedAt: Date.now(),
						})
				}
				if (map.size) rerender(payload.messageId)
				return payload
			},
		),
	]
}
