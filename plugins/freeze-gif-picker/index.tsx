import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import * as React from 'react'
import type { AnyFunction } from '@valenced/utils/types'

type Cleanup = (...fns: Array<() => unknown>) => void

type LooseAfter = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (result: any, ...args: any[]) => any,
) => () => void

const afterLoose = after as unknown as LooseAfter

const GIF_PICKER_NAMES = new Set([
	'GIFPickerItemView',
	'GIFPickerCategoryView',
	'GIFPickerResultsList',
	'GIFPickerCategoriesPage',
	'GIFPickerResultItem',
	'GIFPickerItem',
])

const DISABLE_PROPS: Record<string, boolean> = {
	paused: true,
	autoPlay: false,
	autoplay: false,
	shouldAnimate: false,
	shouldPlay: false,
	isPlaying: false,
	playing: false,
	animate: false,
	animated: false,
}

const STATIC_KEYS = [
	'still',
	'staticUrl',
	'staticURL',
	'static_url',
	'staticSrc',
	'static_src',
	'poster',
	'posterUrl',
	'posterURL',
	'poster_url',
	'thumbnail',
	'thumbnailUrl',
	'thumbnailURL',
	'thumbnail_url',
	'preview',
	'previewUrl',
	'previewURL',
	'preview_url',
	'previewSrc',
	'preview_src',
	'stillUrl',
	'stillURL',
	'still_url',
	'fixed_height_still',
	'fixed_width_still',
	'original_still',
] as const

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null
}

function isProbablyGifUri(uri: unknown): boolean {
	if (typeof uri !== 'string' || !uri) return false
	if (/\.gif(?:[?#]|$)/i.test(uri)) return true
	if (/[?&]format=gif(?:&|$)/i.test(uri)) return true
	if (/\/giphy\.gif(?:[?#]|$)/i.test(uri)) return true
	return false
}

function toStaticGifUri(uri: string): string | undefined {
	try {
		const url = new URL(uri)
		const host = url.hostname.toLowerCase()
		const path = url.pathname

		// Tenor media URLs often have png alternatives for stills.
		if (host.endsWith('tenor.com')) {
			if (/\.gif$/i.test(path)) {
				url.pathname = path.replace(/\.gif$/i, '.png')
				return url.toString()
			}
		}

		// Giphy still variants commonly use *_s.gif.
		if (host.includes('giphy.com')) {
			if (/\/giphy\.gif$/i.test(path)) {
				url.pathname = path.replace(/\/giphy\.gif$/i, '/giphy_s.gif')
				return url.toString()
			}
			if (/\.gif$/i.test(path) && !/_s\.gif$/i.test(path)) {
				url.pathname = path.replace(/\.gif$/i, '_s.gif')
				return url.toString()
			}
		}

		// Discord/media proxy: try requesting png format if supported.
		if (host === 'media.discordapp.net' || host === 'cdn.discordapp.com') {
			if (/\.gif(?:$)/i.test(path)) {
				url.pathname = path.replace(/\.gif$/i, '.png')
				url.searchParams.set('format', 'png')
				return url.toString()
			}
		}

		if (/\.gif$/i.test(path)) {
			url.pathname = path.replace(/\.gif$/i, '.png')
			return url.toString()
		}
	} catch {
		if (/\.gif(?:[?#]|$)/i.test(uri))
			return uri.replace(/\.gif(?=[?#]|$)/i, '.png')
	}
	return undefined
}

function pickStaticUri(value: unknown, depth = 0): string | undefined {
	if (!isRecord(value) || depth > 3) return undefined

	for (const key of STATIC_KEYS) {
		const v = (value as any)[key]
		if (typeof v === 'string' && v) return v
		if (isRecord(v)) {
			if (typeof v.uri === 'string' && v.uri) return v.uri
			if (typeof v.url === 'string' && v.url) return v.url
			if (typeof v.src === 'string' && v.src) return v.src
			const nested = pickStaticUri(v, depth + 1)
			if (nested) return nested
		}
	}

	// Common nested shapes: { url, proxy_url, width, height } etc.
	for (const key of [
		'image',
		'images',
		'media',
		'asset',
		'preview',
		'thumbnail',
		'still',
	]) {
		const v = (value as any)[key]
		if (isRecord(v)) {
			const nested = pickStaticUri(v, depth + 1)
			if (nested) return nested
		}
	}

	return undefined
}

function rewriteUriMaybe(
	uri: unknown,
	staticHint?: string,
): string | undefined {
	if (typeof uri !== 'string' || !uri) return undefined
	if (staticHint && staticHint !== uri) return staticHint
	if (!isProbablyGifUri(uri)) return undefined
	return toStaticGifUri(uri)
}

function freezeProps(props: any): any {
	if (!isRecord(props)) return props

	let next: any = props
	const ensure = () => {
		if (next === props) next = { ...props }
		return next
	}

	for (const [key, value] of Object.entries(DISABLE_PROPS)) {
		if (key in props && props[key] !== value) ensure()[key] = value
	}

	if ('isFocused' in props && props.isFocused === true)
		ensure().isFocused = false
	if ('focused' in props && props.focused === true) ensure().focused = false
	if ('isVisible' in props && props.isVisible !== false) {
		// keep visibility, but not as "actively playing" signal in some implementations
	}

	const staticHint =
		pickStaticUri(props) ??
		pickStaticUri(props.item) ??
		pickStaticUri(props.gif) ??
		pickStaticUri(props.data) ??
		pickStaticUri(props.result)

	if (isRecord(props.source)) {
		const src = props.source as Record<string, any>
		const uri = src.uri ?? src.url ?? src.src
		const rewritten = rewriteUriMaybe(uri, staticHint)
		if (typeof rewritten === 'string' && rewritten && rewritten !== uri) {
			const newSource = { ...src }
			if (
				'uri' in newSource ||
				typeof src.uri === 'string' ||
				!('url' in newSource)
			)
				newSource.uri = rewritten
			if ('url' in newSource) newSource.url = rewritten
			if ('src' in newSource) newSource.src = rewritten
			ensure().source = newSource
		}
	}

	for (const key of ['src', 'uri', 'url', 'imageUrl', 'gifUrl', 'previewUrl']) {
		const v = props[key]
		if (typeof v === 'string') {
			const rewritten = rewriteUriMaybe(v, staticHint)
			if (rewritten && rewritten !== v) ensure()[key] = rewritten
		}
	}

	for (const bagKey of [
		'imageProps',
		'videoProps',
		'playerProps',
		'animatedProps',
		'mediaProps',
	]) {
		const bag = props[bagKey]
		if (isRecord(bag)) {
			const frozenBag = freezeProps(bag)
			if (frozenBag !== bag) ensure()[bagKey] = frozenBag
		}
	}

	// If renderItem/item shape contains gif data, rewrite inside it too (shallowly).
	for (const itemKey of ['item', 'gif', 'data', 'result']) {
		const item = props[itemKey]
		if (isRecord(item)) {
			const nextItem = freezeProps(item)
			if (nextItem !== item) ensure()[itemKey] = nextItem
		}
	}

	return next
}

const seen = new WeakSet<object>()

function freezeTree(node: any, depth = 0): any {
	if (node == null || depth > 14) return node

	if (Array.isArray(node)) {
		let changed = false
		const out = node.map(child => {
			const next = freezeTree(child, depth + 1)
			if (next !== child) changed = true
			return next
		})
		return changed ? out : node
	}

	if (!React.isValidElement(node)) return node

	const el = node as any
	if (seen.has(el)) return el

	const props = el.props
	if (!isRecord(props)) return el

	const nextProps = freezeProps(props)
	let childChanged = false
	let nextChildren = props.children

	if (props.children != null) {
		nextChildren = freezeTree(props.children, depth + 1)
		if (nextChildren !== props.children) childChanged = true
	}

	if (nextProps === props && !childChanged) {
		seen.add(el)
		return el
	}

	const finalProps = nextProps === props ? { ...props } : { ...nextProps }
	if (childChanged) finalProps.children = nextChildren

	try {
		const cloned = React.cloneElement(el, finalProps)
		seen.add(cloned)
		return cloned
	} catch {
		seen.add(el)
		return el
	}
}

function wrapRenderResult(result: any): any {
	try {
		return freezeTree(result)
	} catch {
		return result
	}
}

const patchedFns = new WeakSet<AnyFunction>()

function looksLikeGifPickerComponentName(name: string): boolean {
	if (!name) return false
	if (GIF_PICKER_NAMES.has(name)) return true
	if (name.includes('GIFPicker') || name.includes('GifPicker')) return true
	return false
}

function patchFunctionComponent(
	parent: any,
	key: string,
	cleanup: Cleanup,
): void {
	try {
		if (!parent || (typeof parent !== 'object' && typeof parent !== 'function'))
			return
		const fn = parent[key]
		if (typeof fn !== 'function' || patchedFns.has(fn)) return

		const name = String(fn.displayName ?? fn.name ?? key ?? '')
		if (!looksLikeGifPickerComponentName(name) && key !== 'default') return
		// If patching default by weak signal, require picker-ish name.
		if (key === 'default' && !looksLikeGifPickerComponentName(name)) return

		patchedFns.add(fn)
		const unpatch = afterLoose(parent, key, result => wrapRenderResult(result))
		cleanup(unpatch)
	} catch {}
}

function scanNamespace(ns: any, cleanup: Cleanup): void {
	if (!isRecord(ns)) return

	const visited = new Set<any>()
	const walk = (obj: any, depth: number) => {
		if (!isRecord(obj) || depth > 2 || visited.has(obj)) return
		visited.add(obj)

		for (const key of Object.keys(obj)) {
			let value: any
			try {
				value = obj[key]
			} catch {
				continue
			}

			if (typeof value === 'function') {
				const name = String(value.displayName ?? value.name ?? key ?? '')
				if (
					looksLikeGifPickerComponentName(name) ||
					looksLikeGifPickerComponentName(key)
				) {
					patchFunctionComponent(obj, key, cleanup)
				}
			} else if (isRecord(value) && depth < 2) {
				walk(value, depth + 1)
			}
		}

		if (typeof obj.default === 'function') {
			const name = String(obj.default.displayName ?? obj.default.name ?? '')
			if (looksLikeGifPickerComponentName(name)) {
				patchFunctionComponent(obj, 'default', cleanup)
			}
		}
	}

	walk(ns, 0)
}

export default plugin({
	start({ cleanup }) {
		for (const name of [
			'GIFPickerItemView',
			'GIFPickerResultItem',
			'GIFPickerResultsList',
			'GIFPickerCategoryView',
			'GIFPickerCategoriesPage',
			'GIFPicker',
		]) {
			try {
				cleanup(
					getModules(withName(name), (m: any) => scanNamespace(m, cleanup), {
						returnNamespace: true,
					}),
				)
			} catch {}
		}

		try {
			cleanup(
				getModules(
					(m: any) => {
						try {
							if (!m || typeof m !== 'object') return false
							const scan = (obj: any, depth: number): boolean => {
								if (!obj || typeof obj !== 'object' || depth > 2) return false
								for (const [k, v] of Object.entries(obj)) {
									if (looksLikeGifPickerComponentName(k)) return true
									if (typeof v === 'function') {
										const n = String(
											(v as any).displayName ?? (v as any).name ?? '',
										)
										if (looksLikeGifPickerComponentName(n)) return true
									} else if (v && typeof v === 'object' && depth < 2) {
										if (scan(v, depth + 1)) return true
									}
								}
								return false
							}
							return scan(m, 0)
						} catch {
							return false
						}
					},
					(m: any) => scanNamespace(m, cleanup),
					{ returnNamespace: true },
				),
			)
		} catch {}
	},
})
