export interface ServerNote {
	color: string
	note: string
}

export interface Settings {
	notes: Record<string, ServerNote>
}

export const DefaultSettings: Settings = {
	notes: {},
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

export const TagColorNames: Record<string, string> = {
	default: 'Gray',
	blue: 'Blue',
	pink: 'Pink',
	purple: 'Purple',
	green: 'Green',
	yellow: 'Yellow',
	red: 'Red',
	orange: 'Orange',
	cyan: 'Cyan',
}

export const DefaultTagColor = 'default'

export function tagColorHex(key: string): string {
	return TagColors[key] ?? TagColors[DefaultTagColor]
}
