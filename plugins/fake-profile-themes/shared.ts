export interface Settings {
	nitroFirst: boolean
	primary: string
	accent: string
}

export const DefaultSettings: Settings = {
	nitroFirst: true,
	primary: '#5865f2',
	accent: '#eb459e',
}

const StartCodepoint = 0xe0000
const EndCodepoint = 0xe007f

export function normalizeHex(value: string): string | null {
	const match = value.trim().match(/^#?([a-fA-F0-9]{6})$/)
	return match ? `#${match[1].toLowerCase()}` : null
}

export function hexToNumber(value: string): number | null {
	const hex = normalizeHex(value)
	return hex ? Number.parseInt(hex.slice(1), 16) : null
}

/**
 * Discord's color picker returns a number, but some builds hand back a hex
 * string or an object with a color property. Accept all of them.
 */
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

export function encodeColors(primary: number, accent: number): string {
	const message = `[#${primary.toString(16).padStart(6, '0')},#${accent.toString(16).padStart(6, '0')}]`
	const encoded = Array.from(message)
		.map(char => String.fromCodePoint(char.codePointAt(0)! + StartCodepoint))
		.join('')

	return ` ${encoded}`
}

const DecodeRegex = /\[#([a-fA-F0-9]{1,6}),#([a-fA-F0-9]{1,6})\]/g

export function decodeColors(
	bio: string | null | undefined,
): [number, number] | null {
	if (!bio) return null

	let ascii = ''
	for (const char of bio) {
		const codepoint = char.codePointAt(0)!
		if (codepoint >= StartCodepoint && codepoint <= EndCodepoint) {
			ascii += String.fromCodePoint(codepoint - StartCodepoint)
		}
	}

	// Bios can contain several hidden codes, for example after updating the
	// colors without removing the previous one. The newest code is normally
	// the one closest to the end, so prefer the last match.
	const matches = [...ascii.matchAll(DecodeRegex)]
	const match = matches[matches.length - 1]
	if (!match) return null

	return [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16)]
}
