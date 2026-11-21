import { getDeletedReactions, reconcile, recordMessage } from './logger'
import {
	DeletedBurstColors,
	emojiKey,
	ReactionType,
	reactionKey,
} from './shared'
import type { MessageRow, ReactionData } from './shared'

/** Discord marks a regenerated row as changed before sending it to native. */
const UpdateChangeType = 2

function presentTypes(
	messageId: string,
	reactions: ReactionData[],
): Set<string> {
	const present = new Set<string>()
	for (const reaction of reactions) {
		if ((reaction.count ?? 0) > 0)
			present.add(reactionKey(messageId, reaction.emoji, ReactionType.Normal))
		if ((reaction.burstCount ?? reaction.burst_count ?? 0) > 0)
			present.add(reactionKey(messageId, reaction.emoji, ReactionType.Burst))
	}
	return present
}

function styleDeleted(reaction: ReactionData): ReactionData {
	const burst = Math.max(
		reaction.burstCount ?? reaction.burst_count ?? reaction.count ?? 1,
		1,
	)
	const colors = {
		light: { ...DeletedBurstColors.light },
		dark: { ...DeletedBurstColors.dark },
		LIGHT: { ...DeletedBurstColors.light },
		DARK: { ...DeletedBurstColors.dark },
	}

	return {
		...reaction,
		// A burst pill is native's per-reaction colored pill. Keeping count at
		// zero avoids a second, normal pill for the same emoji.
		count: 0,
		burstCount: burst,
		burst_count: burst,
		me: false,
		isMe: false,
		isMeBurst: false,
		themedBurstColors: colors,
		themed_burst_colors: colors,
	}
}

export function styleRow(row: MessageRow): MessageRow {
	const message = row?.type === 1 ? row.message : undefined
	const id = message?.id
	if (!message || !id) return row

	const reactions: ReactionData[] = message.reactions ?? []
	recordMessage(id, message.channelId, reactions)
	reconcile(id, reactions)

	const deleted = getDeletedReactions(id)
	if (!deleted.length) return row

	const present = presentTypes(id, reactions)
	const restored: ReactionData[] = []
	const restoredEmojis = new Set<string>()

	for (const entry of deleted) {
		if (present.has(reactionKey(id, entry.reaction.emoji, entry.type))) continue

		// Two logged types of one emoji would produce two red pills.
		const emoji = emojiKey(entry.reaction.emoji)
		if (restoredEmojis.has(emoji)) continue
		restoredEmojis.add(emoji)

		restored.push(styleDeleted(entry.reaction))
	}

	if (!restored.length) return row

	message.reactions = [...reactions, ...restored]
	row.changeType = UpdateChangeType
	return row
}
