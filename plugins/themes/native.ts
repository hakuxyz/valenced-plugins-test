import {
	callNativeMethod,
	callNativeMethodSync,
} from '@valenced/modules/native'

export interface EmojiSelection {
	plugin: string
	group: string
	pack: string
	images: string
}

declare module '@valenced/modules/native' {
	interface NativeMethods {
		'valenced.themes.getState': [[], string]
		'valenced.themes.setEmoji': [[json: string], null]
	}
}

/** Selection currently applied by the Themes API, if any. */
export function readEmojiSelection(): EmojiSelection | undefined {
	const state = JSON.parse(
		callNativeMethodSync('valenced.themes.getState', []),
	) as { emoji?: EmojiSelection }
	return state.emoji
}

/** Persists the selection native applies before JavaScript starts. */
export function writeEmojiSelection(selection: EmojiSelection) {
	return callNativeMethod('valenced.themes.setEmoji', [
		JSON.stringify(selection),
	])
}
