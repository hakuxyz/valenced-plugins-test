import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
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
	'GIFPickerSearchSuggestions',
	'GIFPickerNoResults',
	'GIFPicker',
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
	loop: false,
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
	'nano_gif',
	'nanogif',
	'tinygif',
] as const

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null
}

function isAnimatedMediaUri(uri: unknown): boolean {
	if (typeof uri !== 'string' || !uri) return false
	if (/\.gif(?:[?#]|$)/i.test(uri)) return true
	if (/[?&](?:format|fm)=gif(?:&|$)/i.test(uri)) return true
	if (/\/giphy\.gif(?:[?#]|$)/i.test(uri)) return true
	if (/\.gifv(?:[?#]|$)/i.test(uri)) return true
	return false
}

function isPickerLikelyMediaUri(uri: unknown): boolean {
	if (typeof uri !== 'string' || !uri) return false
	return (
		/tenor\.com/i.test(uri) ||
		/giphy\.com/i.test(uri) ||
		/klipy\.com/i.test(uri) ||
		/media\.discordapp\.net/i.test(uri) ||
		/cdn\.discordapp\.com/i.test(uri) ||
		/images-ext-\d+\.discordapp\.net/i.test(uri)
	)
}

function toStaticMediaUri(uri: string): string | undefined {
	try {
		const url = new URL(uri)
		const host = url.hostname.toLowerCase()
		const path = url.pathname

		if (host.endsWith('tenor.com')) {
			if (/\.gif$/i.test(path)) {
				url.pathname = path.replace(/\.gif$/i, '.png')
				url.search = ''
				return url.toString()
			}
			if (/\.mp4$/i.test(path)) {
				// Tenor MP4s don't have a guaranteed static sibling; keep mp4 but we'll pause.
				return undefined
			}
		}

		if (host.includes('giphy.com')) {
			if (/\/giphy\.gif$/i.test(path)) {
				url.pathname = path.replace(/\/giphy\.gif$/i, '/giphy_s.gif')
				return url.toString()
			}
			if (/\.gif$/i.test(path) && !/_s\.gif$/i.test(path)) {
				url.pathname = path.replace(/\.gif$/i, '_s.gif')
				return url.toString()
			}
			if (/\.mp4$/i.test(path)) return undefined
		}

		if (
			host === 'media.discordapp.net' ||
			host === 'cdn.discordapp.com' ||
			host.endsWith('.discordapp.net')
		) {
			if (/\.gif$/i.test(path)) {
				url.pathname = path.replace(/\.gif$/i, '.png')
				url.searchParams.set('format', 'png')
				url.searchParams.delete('frame')
				return url.toString()
			}
			if (url.searchParams.get('format') === 'gif') {
				url.searchParams.set('format', 'png')
				url.searchParams.delete('frame')
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
	if (!isRecord(value) || depth > 4) return undefined

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

	for (const key of [
		'image',
		'images',
		'media',
		'asset',
		'preview',
		'thumbnail',
		'still',
		'gif',
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
	if (staticHint && staticHint !== uri && isPickerLikelyMediaUri(uri))
		return staticHint
	if (isAnimatedMediaUri(uri)) return toStaticMediaUri(uri) ?? staticHint
	return undefined
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
	if ('shouldPlay' in props) ensure().shouldPlay = false
	if ('isPlaying' in props) ensure().isPlaying = false

	const staticHint =
		pickStaticUri(props) ??
		pickStaticUri(props.item) ??
		pickStaticUri(props.gif) ??
		pickStaticUri(props.data) ??
		pickStaticUri(props.result) ??
		pickStaticUri(props.asset)

	const applyToSourceObj = (src: Record<string, any>) => {
		const uri = src.uri ?? src.url ?? src.src
		const rewritten = rewriteUriMaybe(uri, staticHint)
		if (typeof rewritten === 'string' && rewritten && rewritten !== uri) {
			const newSource = { ...src }
			if (
				'uri' in newSource ||
				typeof src.uri === 'string' ||
				!('url' in newSource && !('uri' in newSource))
			)
				newSource.uri = rewritten
			if ('url' in newSource) newSource.url = rewritten
			if ('src' in newSource) newSource.src = rewritten
			return newSource
		}
		return src
	}

	if (isRecord(props.source)) {
		const newSource = applyToSourceObj(props.source)
		if (newSource !== props.source) ensure().source = newSource
	}

	for (const key of [
		'src',
		'uri',
		'url',
		'imageUrl',
		'gifUrl',
		'previewUrl',
		'posterUrl',
	]) {
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
		'posterSource',
	]) {
		const bag = props[bagKey]
		if (isRecord(bag)) {
			const frozenBag = freezeProps(bag)
			if (frozenBag !== bag) ensure()[bagKey] = frozenBag
		}
	}

	for (const itemKey of ['item', 'gif', 'data', 'result', 'asset']) {
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
	if (/^GIFPicker/.test(name)) return true
	// Some builds may use ExpressionPicker-related gif views
	if (name.toLowerCase().includes('gif') && name.toLowerCase().includes('pick'))
		return true
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

function patchGifStore(cleanup: Cleanup): void {
	try {
		cleanup(
			getModules(
				withName('GIFPickerViewStore'),
				(m: any) => {
					try {
						if (!isRecord(m)) return
						const targets = [
							m,
							m.default,
							m.store,
							m.GIFPickerViewStore,
						].filter(isRecord)
						for (const t of targets) {
							for (const key of Object.keys(t)) {
								const fn = (t as any)[key]
								if (typeof fn !== 'function') continue
								if (
									/shouldAnimate|getShouldAnimate|isAutoplay|autoplay/i.test(
										key,
									)
								) {
									if (patchedFns.has(fn)) continue
									patchedFns.add(fn)
									cleanup(afterLoose(t as any, key, () => false))
								}
							}
						}
					} catch {}
				},
				{ returnNamespace: true },
			),
		)
	} catch {}

	try {
		cleanup(
			getModules(
				withProps('getTrendingSearchTerms', 'search'),
				(m: any) => {
					// best-effort: some gif picker stores/utils expose search-related methods; patch any autoplay flags if present
					try {
						if (!isRecord(m)) return
						for (const key of Object.keys(m)) {
							const fn = (m as any)[key]
							if (typeof fn !== 'function') continue
							if (/shouldAnimate|getShouldAnimate/i.test(key)) {
								if (patchedFns.has(fn)) continue
								patchedFns.add(fn)
								cleanup(afterLoose(m, key, () => false))
							}
						}
					} catch {}
				},
				{ returnNamespace: true },
			),
		)
	} catch {}
}

function patchCreateElement(cleanup: Cleanup): void {
	try {
		const reactMod: any = React as any
		const orig = reactMod.createElement
		if (typeof orig !== 'function' || patchedFns.has(orig)) return
		patchedFns.add(orig)

		reactMod.createElement = function patchedCreateElement(
			type: any,
			props: any,
			...children: any[]
		) {
			try {
				// Only intervene when props suggest animated/media/gif picker content.
				if (isRecord(props)) {
					const sourceUri = isRecord(props.source)
						? (props.source.uri ?? props.source.url ?? props.source.src)
						: (props.uri ?? props.url ?? props.src)

					const hasGifHint =
						isAnimatedMediaUri(sourceUri) ||
						(isPickerLikelyMediaUri(sourceUri) &&
							('paused' in props ||
								'autoPlay' in props ||
								'autoplay' in props ||
								'shouldPlay' in props ||
								'isPlaying' in props ||
								'shouldAnimate' in props))

					if (hasGifHint) {
						const nextProps = freezeProps(props)
						if (nextProps !== props) {
							return orig.call(this, type, nextProps, ...children)
						}
					}
				}
			} catch {}
			return orig.call(this, type, props, ...children)
		}

		cleanup(() => {
			try {
				reactMod.createElement = orig
			} catch {}
		})
	} catch {}
}

export default plugin({
	start({ cleanup }) {
		for (const name of [
			'GIFPicker',
			'GIFPickerItemView',
			'GIFPickerResultItem',
			'GIFPickerResultsList',
			'GIFPickerCategoryView',
			'GIFPickerCategoriesPage',
			'GIFPickerSearchSuggestions',
			'GIFPickerNoResults',
			'GIFPickerHeader',
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

		patchGifStore(cleanup)
		patchCreateElement(cleanup)
	},
})
