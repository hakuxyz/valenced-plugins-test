import { processColor } from 'react-native'
import { getDeletedReactions, reconcile, recordMessage } from './logger'
import { emojiKey, ReactionType, reactionKey } from './shared'
import type { MessageRow, ReactionData } from './shared'

/** Discord marks a regenerated row as changed before sending it to native. */
const UpdateChangeType = 2
const DeepRed = processColor('#8B0000')

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
	const styled: ReactionData = {
		...reaction,
		count: Math.max(reaction.count ?? 1, 1),
		me: false,
		isMe: false,
		isMeBurst: false,
	}

	// A burst pill is what triggers Nitro's "A better way to react" prompt.
	delete styled.burstCount
	delete styled.burst_count
	delete styled.themedBurstColors
	delete styled.themed_burst_colors
	return styled
}

function outlineReactions(row: MessageRow): void {
	const border = DeepRed
	const theme: Record<string, unknown> = {
		reactionBackgroundColor: 0,
		reactionBorderColor: border,
		reactionTextColor: null,
		activeReactionBackgroundColor: null,
		activeReactionBorderColor: null,
		activeReactionTextColor: null,
		REACTION_BACKGROUND_COLOR: 0,
		REACTION_BORDER_COLOR: border,
		REACTION_TEXT_COLOR: null,
		ACTIVE_REACTION_BACKGROUND_COLOR: null,
		ACTIVE_REACTION_BORDER_COLOR: null,
		ACTIVE_REACTION_TEXT_COLOR: null,
	}

	row.reactionsTheme = theme
	for (const accessory of row.accessories ?? []) {
		if (
			accessory &&
			(accessory.type === 'reactions' || accessory.reactionsTheme)
		)
			accessory.reactionsTheme = theme
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

		const emoji = emojiKey(entry.reaction.emoji)
		if (restoredEmojis.has(emoji)) continue
		restoredEmojis.add(emoji)

		restored.push(styleDeleted(entry.reaction))
	}

	if (!restored.length) return row

	message.reactions = [...reactions, ...restored]
	row.changeType = UpdateChangeType
	outlineReactions(row)
	return row
}
