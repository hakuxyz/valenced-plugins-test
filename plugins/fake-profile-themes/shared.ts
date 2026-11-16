export interface Settings {
	nitroFirst: boolean
	autoBio: boolean
	primary: string
	accent: string
}

export const DefaultSettings: Settings = {
	nitroFirst: true,
	autoBio: true,
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

/**
 * Remove every legacy 3y3 color code from a bio while leaving other text and
 * invisible characters alone. Used when writing a new code so the old one
 * does not keep winning.
 */
export function stripColorCodes(bio: string): string {
	let result = ''
	let run: string[] = []

	const flush = () => {
		if (run.length === 0) return

		const chars = [...run]
		const ascii = chars
			.map(char => String.fromCodePoint(char.codePointAt(0)! - StartCodepoint))
			.join('')
		const remove = new Array<boolean>(chars.length).fill(false)
		let hasCode = false

		for (const match of ascii.matchAll(DecodeRegex)) {
			hasCode = true
			const start = match.index ?? 0
			for (let i = start; i < start + match[0].length; i++) {
				remove[i] = true
			}
		}

		// encodeColors prepends a space to the hidden code. Remove it again so
		// repeated color changes do not accumulate spaces in the bio.
		if (hasCode && result.endsWith(' ')) result = result.slice(0, -1)

		for (let i = 0; i < chars.length; i++) {
			if (!remove[i]) result += chars[i]
		}

		run = []
	}

	for (const char of bio) {
		const codepoint = char.codePointAt(0)!
		if (codepoint >= StartCodepoint && codepoint <= EndCodepoint) {
			run.push(char)
		} else {
			flush()
			result += char
		}
	}
	flush()

	return result
}

export const MaxBioLength = 190

/**
 * Replace every legacy color code in the bio with the current colors.
 * Returns null when the bio would exceed Discord's limit.
 */
export function withColorCode(
	bio: string,
	primary: number,
	accent: number,
): string | null {
	const cleaned = stripColorCodes(bio)
	const code = encodeColors(primary, accent)

	if (cleaned.length + code.length > MaxBioLength) return null

	return cleaned + code
}
