export interface ReactionEmoji {
	id?: string | null
	name?: string | null
	src?: string
	displayName?: string
	animated?: boolean | null
}

export interface ReactionType {
	Normal: 0
	Burst: 1
}

export const ReactionType: ReactionType = {
	Normal: 0,
	Burst: 1,
}

export interface ReactionData {
	count: number
	burstCount?: number
	burst_count?: number
	emoji: ReactionEmoji
	me?: boolean
	isMe?: boolean
	isMeBurst?: boolean
	themedBurstColors?: unknown
	themed_burst_colors?: unknown
	[key: string]: unknown
}

export interface LoggedReaction {
	reaction: ReactionData
	type: number
	deletedAt: number
	userId?: string
}

export interface MessageRow {
	type?: number
	changeType?: number
	message?: RowMessage
	reactionsTheme?: Record<string, unknown>
	accessories?: Array<{
		type?: string
		reactionsTheme?: Record<string, unknown>
	}>
}

export interface RowMessage {
	id: string
	channelId?: string
	reactions?: ReactionData[]
}

export interface RowManager {
	prototype: {
		generate(row: unknown): MessageRow
	}
}

export interface ReactionAction {
	type: string
	messageId?: string
	channelId?: string
	emoji?: ReactionEmoji
	reactionType?: number
	userId?: string
	users?: Array<{ id: string }>
}

export function emojiKey(emoji: ReactionEmoji): string {
	return emoji.id ?? emoji.name ?? ''
}

export function reactionKey(
	messageId: string,
	emoji: ReactionEmoji,
	type = 0,
): string {
	return `${messageId}:${emojiKey(emoji)}:${type}`
}

export function logKey(
	messageId: string,
	emoji: ReactionEmoji,
	type = 0,
	userId?: string,
): string {
	return `${reactionKey(messageId, emoji, type)}:${userId ?? ''}`
}
