export interface ServerNote {
	color: string
	note: string
}

export const DefaultSettings: Settings = {
	notes: {},
}

export interface Settings {
	notes: Record<string, ServerNote>
}

export const TagColors: Record<string, string> = {
	default: '#4e5058',
	blue: '#5865f2',
	pink: '#eb459e',
	purple: '#a259bb',
	green: '#23a55a',
	yellow: '#f0b232',
	red: '#f23f43',
	orange: '#e67e22',
	cyan: '#00a8fc',
}

export const DefaultTagColor = 'default'

export function tagColorHex(key: string): string {
	return TagColors[key] ?? TagColors[DefaultTagColor]
}
