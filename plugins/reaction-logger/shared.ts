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

export interface BurstColorPalette {
	backgroundColor: string
	accentColor: string
	highlightColor: string
	opacity: number
	BACKGROUND_COLOR?: string
	ACCENT_COLOR?: string
	HIGHLIGHT_COLOR?: string
	OPACITY?: number
}

export interface ThemedBurstColors {
	light: BurstColorPalette
	dark: BurstColorPalette
	LIGHT?: BurstColorPalette
	DARK?: BurstColorPalette
}

export interface ReactionData {
	count: number
	burstCount?: number
	burst_count?: number
	emoji: ReactionEmoji
	me?: boolean
	isMe?: boolean
	isMeBurst?: boolean
	themedBurstColors?: ThemedBurstColors | null
	themed_burst_colors?: ThemedBurstColors | null
	[key: string]: unknown
}

export interface LoggedReaction {
	reaction: ReactionData
	type: number
	deletedAt: number
}

export interface MessageRow {
	type?: number
	changeType?: number
	message?: RowMessage
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

export const MessageRowType = 1
export const UpdateChangeType = 2

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

const RED_PALETTE: BurstColorPalette = {
	backgroundColor: '#FF4B4B',
	accentColor: '#9E9E9E',
	highlightColor: '#FF4B4B',
	opacity: 1,
	BACKGROUND_COLOR: '#FF4B4B',
	ACCENT_COLOR: '#9E9E9E',
	HIGHLIGHT_COLOR: '#FF4B4B',
	OPACITY: 1,
}

// Current Discord serializes these fields in caps; older ones used lowercase.
export const DeletedBurstColors: ThemedBurstColors = {
	light: RED_PALETTE,
	dark: RED_PALETTE,
	LIGHT: RED_PALETTE,
	DARK: RED_PALETTE,
}
