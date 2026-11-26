import { processColor } from 'react-native'
import { getDeletedReactions, recordMessage } from './logger'
import { reactionKey } from './shared'
import type { LoggedReaction, MessageRow, ReactionData } from './shared'

/** Discord marks a regenerated row as changed before sending it to native. */
const UpdateChangeType = 2
const DeepRed = processColor('#8B0000')

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

	const deleted = getDeletedReactions(id)
	if (!deleted.length) return row

	const grouped = new Map<string, LoggedReaction & { count: number }>()
	for (const entry of deleted) {
		const key = reactionKey(id, entry.reaction.emoji, entry.type)
		const group = grouped.get(key)
		if (!group) {
			grouped.set(key, { ...entry, count: 1 })
			continue
		}
		group.count++
		if (entry.deletedAt > group.deletedAt) {
			group.deletedAt = entry.deletedAt
			group.userId = entry.userId
		}
	}

	const restored: ReactionData[] = []
	for (const group of grouped.values()) {
		const reaction = styleDeleted(group.reaction)
		reaction.count = group.count
		restored.push(reaction)
	}

	message.reactions = [...reactions, ...restored]
	row.changeType = UpdateChangeType
	outlineReactions(row)
	return row
}
