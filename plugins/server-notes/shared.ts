export interface ServerNote {
	/** Preset key or "#rrggbb" hex color */
	color: string
	note: string
}

export interface Settings {
	notes: Record<string, ServerNote>
	/** Guild ID to auto-open in editor when settings open (transient helper) */
	pendingGuildId?: string | null
}

export const DefaultSettings: Settings = {
	notes: {},
	pendingGuildId: null,
}

export const PresetColors: Record<string, string> = {
	gray: '#4e5058',
	blue: '#5865f2',
	blurple: '#7289da',
	green: '#23a55a',
	yellow: '#f0b232',
	orange: '#e67e22',
	red: '#f23f43',
	pink: '#eb459e',
	magenta: '#e91e63',
	purple: '#9b59b6',
	violet: '#7c4dff',
	cyan: '#00a8fc',
	teal: '#1abc9c',
	lime: '#57f287',
	brown: '#795548',
	white: '#ffffff',
}

export const PresetColorNames: Record<string, string> = {
	gray: 'Gray',
	blue: 'Blue',
	blurple: 'Blurple',
	green: 'Green',
	yellow: 'Yellow',
	orange: 'Orange',
	red: 'Red',
	pink: 'Pink',
	magenta: 'Magenta',
	purple: 'Purple',
	violet: 'Violet',
	cyan: 'Cyan',
	teal: 'Teal',
	lime: 'Lime',
	brown: 'Brown',
	white: 'White',
}

export const DefaultTagColor = 'gray'

export function normalizeHex(value: string): string | null {
	const match = value.trim().match(/^#?([a-fA-F0-9]{6})$/)
	return match ? `#${match[1].toLowerCase()}` : null
}

export function hexToNumber(value: string): number | null {
	const hex = normalizeHex(value)
	return hex ? Number.parseInt(hex.slice(1), 16) : null
}

export function colorValueToNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.trunc(value) & 0xffffff
	}
	if (typeof value === 'string') return hexToNumber(value)
	if (typeof value === 'object' && value !== null && 'color' in value) {
		return colorValueToNumber((value as { color?: unknown }).color)
	}
	return null
}

export function isHexColor(value: string): boolean {
	return /^#[0-9a-f]{6}$/i.test(value)
}

export function colorToHex(color: string): string {
	if (isHexColor(color)) return color.toLowerCase()
	return PresetColors[color] ?? PresetColors[DefaultTagColor]
}

export function colorLabel(color: string): string {
	if (isHexColor(color)) return color.toUpperCase()
	return PresetColorNames[color] ?? color
}

export function hasMeaningfulNote(note: ServerNote | undefined): boolean {
	if (!note) return false
	return (
		note.note.trim().length > 0 ||
		(!!note.color && note.color !== DefaultTagColor)
	)
}
