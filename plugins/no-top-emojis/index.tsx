import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
} from '@valenced/modules/finders/filters'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { cloneElement } from 'react'
import type { AnyFunction } from '@valenced/utils/types'
import type { ReactElement } from 'react'

type Cleanup = (...fns: Array<() => unknown>) => void

const TOP_MARKER =
	/top[\s_-]*(?:server[\s_-]*)?emoj|emoj[\s_-]*(?:server[\s_-]*)?top|topEmoji|TOP_EMOJI/i

const seen = new Set<string>()
const patched = new WeakSet<AnyFunction>()

function report(key: string, detail: string): void {
	const id = `${key}:${detail.slice(0, 80)}`
	if (seen.has(id)) return
	seen.add(id)
	const text = `${key}: ${detail}`
	try {
		console.log('[no-top-emojis]', text)
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

function hasTopMarker(value: unknown, depth = 0): boolean {
	if (typeof value === 'string') return TOP_MARKER.test(value)
	if (depth > 4) return false
	if (Array.isArray(value))
		return value.some(item => hasTopMarker(item, depth + 1))
	if (!isPlain(value)) return false
	return Object.entries(value).some(
		([key, item]) => TOP_MARKER.test(key) || hasTopMarker(item, depth + 1),
	)
}

function cleanValue(value: unknown, depth = 0): unknown {
	if (depth > 4) return value
	if (Array.isArray(value)) {
		const kept = value.filter(item => !hasTopMarker(item))
		return kept.map(item => cleanValue(item, depth + 1))
	}
	if (!isPlain(value)) return value

	let next: Record<string, unknown> | undefined
	for (const [key, item] of Object.entries(value)) {
		if (TOP_MARKER.test(key)) {
			next ??= { ...value }
			delete next[key]
			continue
		}
		const result = cleanValue(item, depth + 1)
		if (result === item) continue
		next ??= { ...value }
		next[key] = result
	}
	return next ?? value
}

function isTopHeader(value: unknown): boolean {
	return (
		isPlain(value) &&
		value.type === 1 &&
		typeof value.title === 'string' &&
		/^top emoji/i.test(value.title)
	)
}

function cleanPickerData(value: unknown): unknown {
	if (
		!isPlain(value) ||
		!Array.isArray(value.data) ||
		!Array.isArray(value.headerIndices)
	) {
		return value
	}

	const removed = new Set<number>()
	for (let i = 0; i < value.data.length; i++) {
		if (!isTopHeader(value.data[i])) continue
		removed.add(i)
		for (let j = i + 1; j < value.data.length; j++) {
			if (isPlain(value.data[j]) && value.data[j].type === 1) break
			removed.add(j)
		}
	}
	if (!removed.size) return value

	const indexMap = new Map<number, number>()
	let nextIndex = 0
	for (let i = 0; i < value.data.length; i++) {
		if (!removed.has(i)) indexMap.set(i, nextIndex++)
	}

	return {
		...value,
		data: value.data.filter((_, i) => !removed.has(i)),
		headerIndices: value.headerIndices
			.map(index => indexMap.get(Number(index)))
			.filter((index): index is number => index !== undefined),
	}
}

function dump(value: unknown, depth = 0, limit = 4): string {
	if (typeof value === 'string') return JSON.stringify(value.slice(0, 70))
	if (typeof value === 'function') return 'fn'
	if (value === null || value === undefined) return String(value)
	if (Array.isArray(value)) {
		const items = value
			.slice(0, limit)
			.map(item => dump(item, depth + 1, limit))
		if (value.length > limit) items.push(`+${value.length - limit}`)
		return `[${items.join(',')}]`
	}
	if (isPlain(value)) {
		if (depth > 3) return '{...}'
		return `{${Object.entries(value)
			.slice(0, 12)
			.map(([key, item]) => `${key}:${dump(item, depth + 1, limit)}`)
			.join(',')}}`
	}
	if (isRecord(value))
		return `<obj:${Object.keys(value).slice(0, 5).join(',')}>`
	return String(value)
}

function collect(
	value: unknown,
	output: Map<string, AnyFunction>,
	depth = 0,
): void {
	if (depth > 3 || patched.has(value as AnyFunction)) return
	if (typeof value === 'function') {
		const fn = value as AnyFunction
		const name = (fn as any).displayName || fn.name
		if (name) output.set(name, fn)
		return
	}
	if (!isRecord(value) || '$$typeof' in value) return
	for (const item of Object.values(value)) collect(item, output, depth + 1)
}

const emojiComponents = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		const names = new Map<string, AnyFunction>()
		collect(exports, names)
		return [...names.keys()].some(
			name =>
				/emoji/i.test(name) &&
				/categor|section|header|item|picker|list/i.test(name),
		)
	},
	() => 'noTopEmojis.emojiComponents',
	FilterScopes.Initialized,
)

function patchComponent(name: string, fn: AnyFunction, cleanup: Cleanup): void {
	if (patched.has(fn)) return
	patched.add(fn)
	const unpatch = afterJSX(fn as never, element => {
		try {
			const el = element as ReactElement<Record<string, unknown>>
			const props = el.props ?? {}

			if (name === 'EmojiPickerListComponent') {
				report(name, `data=${dump(props.data, 0, 6)}`)
			}
			if (/EmojiPickerCategor/.test(name)) {
				report(name, `category=${dump(props.category, 0, 6)}`)
			}

			const next = cleanValue(props) as Record<string, unknown>
			if (name === 'EmojiPickerListComponent') {
				const data = cleanPickerData(props.data)
				if (data !== props.data) next.data = data
			}
			const changed = Object.keys(next).some(key => next[key] !== props[key])
			return changed ? (cloneElement(el, next) as never) : (element as never)
		} catch {
			return element as never
		}
	})
	cleanup(() => unpatch())
}

export default plugin({
	start({ cleanup }) {
		cleanup(
			getModules(
				emojiComponents(),
				exports => {
					const names = new Map<string, AnyFunction>()
					collect(exports, names)
					for (const [name, fn] of names) {
						if (
							/emoji/i.test(name) &&
							/categor|section|header|item|picker|list/i.test(name)
						) {
							patchComponent(name, fn, cleanup)
						}
					}
				},
				{ returnNamespace: true },
			),
		)
	},
})
