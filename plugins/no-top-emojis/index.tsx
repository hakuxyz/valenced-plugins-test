import { ToastActionCreators } from '@valenced/discord/actions'
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
	const id = `${key}:${detail}`
	if (seen.has(id)) return
	seen.add(id)
	const text = `${key}: ${detail}`
	try {
		console.log('[no-top-emojis]', text)
		ToastActionCreators.open('HAKUXYZ_NO_TOP_EMOJIS_DIAG', {
			text: text.slice(0, 180),
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

function short(value: unknown, depth = 0): string {
	if (typeof value === 'string') return value.slice(0, 60)
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value)
	if (typeof value === 'function') return `fn:${value.name || '?'}`
	if (value === null || value === undefined) return String(value)
	if (depth > 1) return '...'
	if (Array.isArray(value))
		return `[${value.length}:${short(value[0], depth + 1)}]`
	if (isPlain(value))
		return `{${Object.keys(value)
			.slice(0, 8)
			.map(key => `${key}=${short(value[key], depth + 1)}`)
			.join(',')}}`
	if (isRecord(value)) return Object.keys(value).slice(0, 5).join(',')
	return typeof value
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
				/emoji/i.test(name) && /categor|section|header|item|picker/i.test(name),
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
			const next = cleanValue(props) as Record<string, unknown>
			const changed = Object.keys(next).some(key => next[key] !== props[key])
			report(
				`jsx:${name}`,
				`keys=${Object.keys(props).slice(0, 10).join(',')} ${short(props)}`,
			)
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
							/categor|section|header|item|picker/i.test(name)
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
