import { ToastActionCreators } from '@valenced/discord/actions'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after, instead } from '@valenced/patcher'
import type { AnyFunction } from '@valenced/utils/types'

type Cleanup = (...fns: Array<() => unknown>) => void

type LooseAfter = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (result: any) => any,
) => () => unknown

type LooseInstead = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (args: any[], original: AnyFunction) => any,
) => () => unknown

const afterLoose = after as unknown as LooseAfter
const insteadLoose = instead as unknown as LooseInstead

const TOP_EMOJI_STORE = 'modules/emojis/top_emojis/TopEmojiStore.tsx'
const TOP_EMOJI_HOOK =
	'modules/emoji_picker/hooks/useTopAndNewlyAddedEmojis.tsx'
const PICKER_DATA =
	'modules/emoji_picker/native/components/data/useEmojiPickerData.tsx'
const PICKER_SECTION =
	'modules/emoji_picker/native/components/data/getEmojiPickerDataRowItemNativeSection.tsx'

const STORE_GETTERS = [
	'getTopEmojiIdsByGuildId',
	'getTopEmojisMetadata',
	'getTopEmojiWithoutFetchingLatest',
	'visibleTopEmojis',
] as const

const TOP_EMOJI =
	/top[\s_-]*(?:server[\s_-]*)?emoj|emoj[\s_-]*(?:server[\s_-]*)?top/i

const found: Record<string, boolean> = {
	store: false,
	hook: false,
	data: false,
	section: false,
}

const patched = new WeakSet<AnyFunction>()

function report(): void {
	const summary = Object.entries(found)
		.map(([key, value]) => `${key}:${value ? 'y' : 'n'}`)
		.join(' ')
	try {
		console.log('[no-top-emojis]', summary)
		ToastActionCreators.open('HAKUXYZ_NO_TOP_EMOJIS_DIAG', {
			text: summary,
			variant: 'default',
		})
	} catch {}
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null
}

function isPlain(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value) || '$$typeof' in value) return false
	const proto = Object.getPrototypeOf(value)
	return proto === Object.prototype || proto === null
}

function isTopEmojiItem(value: unknown, depth = 0): boolean {
	if (typeof value === 'string') return TOP_EMOJI.test(value)
	if (Array.isArray(value))
		return value.some(item => isTopEmojiItem(item, depth))
	if (!isPlain(value) || depth > 3) return false

	return Object.values(value).some(item => {
		if (typeof item === 'string') return TOP_EMOJI.test(item)
		return isTopEmojiItem(item, depth + 1)
	})
}

function stripTopEmojis(value: unknown, depth = 0): unknown {
	if (!isPlain(value) && !Array.isArray(value)) return value
	if (depth > 4) return value

	if (Array.isArray(value)) {
		const kept = value.filter(item => !isTopEmojiItem(item))
		return kept.length === value.length ? value : kept
	}

	let next: Record<string, unknown> | undefined
	for (const [key, item] of Object.entries(value)) {
		const result = stripTopEmojis(item, depth + 1)
		if (result === item) continue
		if (!next) next = { ...value }
		next[key] = result
	}
	return next ?? value
}

/** Keep newly added emojis, but empty anything belonging to top emojis. */
function blankTopEmojis(value: unknown): unknown {
	if (!isPlain(value)) return stripTopEmojis(value)

	let next: Record<string, unknown> | undefined
	for (const [key, item] of Object.entries(value)) {
		if (TOP_EMOJI.test(key)) {
			if (Array.isArray(item) || isPlain(item)) {
				next ??= { ...value }
				next[key] = Array.isArray(item) ? [] : {}
			}
			continue
		}
		const result = stripTopEmojis(item)
		if (result === item) continue
		next ??= { ...value }
		next[key] = result
	}
	return next ?? value
}

/** Metro exports can be getters. Make them writable before patching. */
function ensureWritable(parent: any, key: string): void {
	try {
		const desc = Object.getOwnPropertyDescriptor(parent, key)
		if (!desc || desc.configurable === false) return
		if ('value' in desc && desc.writable) return
		const value = parent[key]
		if (typeof value !== 'function') return
		Object.defineProperty(parent, key, {
			value,
			writable: true,
			enumerable: desc.enumerable,
			configurable: true,
		})
	} catch {}
}

function patchGetter(
	parent: any,
	key: string,
	empty: unknown,
	cleanup: Cleanup,
) {
	if (!isRecord(parent) || typeof parent[key] !== 'function') return
	const original = parent[key] as AnyFunction
	if (patched.has(original)) return
	try {
		ensureWritable(parent, key)
		patched.add(original)
		cleanup(insteadLoose(parent, key, () => empty))
	} catch {
		patched.delete(original)
	}
}

function patchStore(exports: unknown, cleanup: Cleanup): void {
	if (!isRecord(exports)) return
	found.store = true

	for (const key of STORE_GETTERS) {
		patchGetter(exports, key, [], cleanup)
		if (isRecord(exports.default)) {
			patchGetter(exports.default, key, [], cleanup)
		}
	}
}

function patchHook(exports: unknown, cleanup: Cleanup): void {
	if (!isRecord(exports)) return
	found.hook = true

	for (const [key, value] of Object.entries(exports)) {
		if (typeof value !== 'function') continue
		const original = value as AnyFunction
		if (patched.has(original)) continue
		try {
			ensureWritable(exports, key)
			patched.add(original)
			cleanup(afterLoose(exports, key, result => blankTopEmojis(result)))
		} catch {
			patched.delete(original)
		}
	}
}

function patchDataHook(exports: unknown, cleanup: Cleanup): void {
	if (!isRecord(exports)) return
	found.data = true

	for (const [key, value] of Object.entries(exports)) {
		if (typeof value !== 'function' || !/emojiPickerData/i.test(key)) continue
		const original = value as AnyFunction
		if (patched.has(original)) continue
		try {
			ensureWritable(exports, key)
			patched.add(original)
			cleanup(afterLoose(exports, key, result => stripTopEmojis(result)))
		} catch {
			patched.delete(original)
		}
	}
}

function patchSectionRow(exports: unknown, cleanup: Cleanup): void {
	if (!isRecord(exports)) return
	found.section = true

	for (const [key, value] of Object.entries(exports)) {
		if (typeof value !== 'function') continue
		const original = value as AnyFunction
		if (patched.has(original)) continue
		try {
			ensureWritable(exports, key)
			patched.add(original)
			cleanup(
				insteadLoose(exports, key, (args, originalFn) => {
					if (args.some(isTopEmojiItem)) return undefined
					return originalFn(...args)
				}),
			)
		} catch {
			patched.delete(original)
		}
	}
}

export default plugin({
	start({ cleanup }) {
		cleanup(
			getModuleWithImportedPath<Record<string, any>>(TOP_EMOJI_HOOK, exports =>
				patchHook(exports, cleanup),
			),
		)
		cleanup(
			getModuleWithImportedPath<Record<string, any>>(TOP_EMOJI_STORE, exports =>
				patchStore(exports, cleanup),
			),
		)
		cleanup(
			getModules(withProps('getTopEmojiIdsByGuildId'), exports => {
				patchStore(exports, cleanup)
			}),
		)
		cleanup(
			getModuleWithImportedPath<Record<string, any>>(PICKER_DATA, exports => {
				patchDataHook(exports, cleanup)
			}),
		)
		cleanup(
			getModuleWithImportedPath<Record<string, any>>(PICKER_SECTION, exports =>
				patchSectionRow(exports, cleanup),
			),
		)
		const timer = setTimeout(report, 1500)
		cleanup(() => clearTimeout(timer))
	},
})
