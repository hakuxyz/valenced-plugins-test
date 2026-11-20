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

let gifPickerRenderDepth = 0
const logged = new Set<string>()

function debugLogOnce(key: string, ...args: any[]) {
	if (logged.has(key)) return
	logged.add(key)
	try {
		console.log('[freeze-gif-picker]', ...args)
	} catch {}
}

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
	'GIFPickerHeader',
	'GIFPickerFavorites',
	'GIFPickerFavoriteItem',
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

function isHttpUrl(uri: unknown): uri is string {
	return typeof uri === 'string' && /^https?:\/\//i.test(uri)
}

function isAnimatedMediaUri(uri: unknown): boolean {
	if (!isHttpUrl(uri)) return false
	if (/\.gif(?:[?#]|$)/i.test(uri)) return true
	if (/\.gifv(?:[?#]|$)/i.test(uri)) return true
	if (/\.apng(?:[?#]|$)/i.test(uri)) return true
	if (/[?&](?:format|fm)=gif(?:&|$)/i.test(uri)) return true
	if (/[?&](?:format|fm)=apng(?:&|$)/i.test(uri)) return true
	if (/\/giphy\.gif(?:[?#]|$)/i.test(uri)) return true
	if (/[?&]animated=true(?:&|$)/i.test(uri)) return true
	return false
}

function isKnownGifProviderHost(hostname: string): boolean {
	const h = hostname.toLowerCase()
	return (
		h.endsWith('tenor.com') ||
		h.includes('giphy.com') ||
		h.endsWith('klipy.com') ||
		h === 'media.discordapp.net' ||
		h === 'cdn.discordapp.com' ||
		h === 'images-ext-1.discordapp.net' ||
		h === 'images-ext-2.discordapp.net' ||
		h.endsWith('.discordapp.net')
	)
}

function setStaticQueryParams(url: URL, force: boolean): boolean {
	let changed = false
	const animated = url.searchParams.get('animated')
	if (animated && animated.toLowerCase() === 'true') {
		url.searchParams.set('animated', 'false')
		changed = true
	} else if (force && isKnownGifProviderHost(url.hostname.toLowerCase())) {
		// For known providers/proxies in aggressive contexts, prefer explicit static.
		// Only set if param exists? no, some animate by default; but adding may be benign.
		// We'll be conservative: set when we already decided to freeze and host is discord/klipy/tenor/giphy.
		if (!url.searchParams.has('animated')) {
			// avoid adding to arbitrary paths except discord proxy/klipy static which we know
			const h = url.hostname.toLowerCase()
			if (
				h.endsWith('.discordapp.net') ||
				h === 'cdn.discordapp.com' ||
				h.endsWith('klipy.com')
			) {
				url.searchParams.set('animated', 'false')
				changed = true
			}
		}
	}
	if (force) {
		const autoplay = url.searchParams.get('autoplay')
		if (autoplay && autoplay !== '0' && autoplay.toLowerCase() !== 'false') {
			url.searchParams.set('autoplay', 'false')
			changed = true
		}
		const play = url.searchParams.get('play')
		if (play && play !== '0' && play.toLowerCase() !== 'false') {
			url.searchParams.set('play', 'false')
			changed = true
		}
	}
	return changed
}

function toStaticMediaUri(
	uri: string,
	aggressive: boolean,
): string | undefined {
	try {
		const url = new URL(uri)
		const host = url.hostname.toLowerCase()
		const path = url.pathname
		let changed = false

		if (setStaticQueryParams(url, aggressive)) changed = true

		// Discord media proxy / external proxy / attachments: prefer static formats.
		if (
			host === 'media.discordapp.net' ||
			host === 'cdn.discordapp.com' ||
			host.endsWith('.discordapp.net')
		) {
			const fmt = (url.searchParams.get('format') || '').toLowerCase()
			if (/\.gif$/i.test(path)) {
				url.pathname = path.replace(/\.gif$/i, '.png')
				url.searchParams.set('format', 'png')
				url.searchParams.delete('frame')
				changed = true
			} else if (fmt === 'gif' || fmt === 'apng') {
				url.searchParams.set('format', 'webp')
				url.searchParams.delete('frame')
				changed = true
			} else if (
				aggressive ||
				/\/external\//i.test(path) ||
				/\/attachments\//i.test(path)
			) {
				if (
					fmt !== 'png' &&
					fmt !== 'webp' &&
					fmt !== 'jpeg' &&
					fmt !== 'jpg'
				) {
					// only force when it might be animated media proxy
					if (
						aggressive ||
						isAnimatedMediaUri(uri) ||
						/\/external\//i.test(path)
					) {
						url.searchParams.set('format', 'webp')
						changed = true
					}
				}
			}
			return changed ? url.toString() : undefined
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
			return changed ? url.toString() : undefined
		}

		if (host.endsWith('tenor.com')) {
			if (/\.gif$/i.test(path)) {
				url.pathname = path.replace(/\.gif$/i, '.png')
				url.search = ''
				return url.toString()
			}
			return changed ? url.toString() : undefined
		}

		if (host.endsWith('klipy.com')) {
			if (/\.gif$/i.test(path)) {
				url.pathname = path.replace(/\.gif$/i, '.webp')
				changed = true
			}
			const fmt = (url.searchParams.get('format') || '').toLowerCase()
			if (fmt === 'gif' || fmt === 'apng') {
				url.searchParams.set('format', 'webp')
				changed = true
			}
			if (aggressive || isAnimatedMediaUri(uri)) {
				if (url.searchParams.get('animated') !== 'false') {
					url.searchParams.set('animated', 'false')
					changed = true
				}
			}
			return changed ? url.toString() : undefined
		}

		if (/\.gif$/i.test(path)) {
			url.pathname = path.replace(/\.gif$/i, '.png')
			return url.toString()
		}
		if (/\.apng$/i.test(path)) {
			url.pathname = path.replace(/\.apng$/i, '.png')
			return url.toString()
		}

		if (/[?&](?:format|fm)=(?:gif|apng)(?:&|$)/i.test(url.search)) {
			url.searchParams.set(
				url.searchParams.has('format') ? 'format' : 'fm',
				'webp',
			)
			changed = true
		}

		return changed ? url.toString() : undefined
	} catch {
		if (/\.gif(?:[?#]|$)/i.test(uri))
			return uri.replace(/\.gif(?=[?#]|$)/i, '.png')
		if (/\.apng(?:[?#]|$)/i.test(uri))
			return uri.replace(/\.apng(?=[?#]|$)/i, '.png')
	}
	return undefined
}

function pickStaticUri(value: unknown, depth = 0): string | undefined {
	if (!isRecord(value) || depth > 5) return undefined

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
		'src',
	]) {
		const v = (value as any)[key]
		if (Array.isArray(v)) {
			for (const item of v) {
				const nested = pickStaticUri(item, depth + 1)
				if (nested) return nested
			}
		} else if (isRecord(v)) {
			const nested = pickStaticUri(v, depth + 1)
			if (nested) return nested
		}
	}

	return undefined
}

function shouldFreezeUri(uri: string, aggressive: boolean): boolean {
	if (isAnimatedMediaUri(uri)) return true
	try {
		const host = new URL(uri).hostname
		if (isKnownGifProviderHost(host))
			return aggressive || /[?&]animated=/i.test(uri)
	} catch {}
	return false
}

function rewriteUriMaybe(
	uri: unknown,
	staticHint?: string,
	aggressive = false,
): string | undefined {
	if (!isHttpUrl(uri)) return undefined

	if (staticHint && isHttpUrl(staticHint) && staticHint !== uri) {
		try {
			const host = new URL(uri).hostname
			if (aggressive || isKnownGifProviderHost(host) || isAnimatedMediaUri(uri))
				return staticHint
		} catch {}
	}

	if (!shouldFreezeUri(uri, aggressive)) return undefined

	const converted = toStaticMediaUri(uri, aggressive)
	if (converted && converted !== uri) return converted

	try {
		const u = new URL(uri)
		if (
			(aggressive || isKnownGifProviderHost(u.hostname)) &&
			isAnimatedMediaUri(uri)
		) {
			debugLogOnce(
				`uri:${u.hostname}${u.pathname}`,
				'unconverted animated media uri',
				uri,
			)
		}
	} catch {}
	return undefined
}

function freezeSourceValue(
	source: any,
	staticHint: string | undefined,
	aggressive: boolean,
): any {
	if (typeof source === 'string') {
		const rewritten = rewriteUriMaybe(source, staticHint, aggressive)
		return rewritten && rewritten !== source ? rewritten : source
	}
	if (Array.isArray(source)) {
		let changed = false
		const out = source.map(item => {
			const next = freezeSourceValue(item, staticHint, aggressive)
			if (next !== item) changed = true
			return next
		})
		return changed ? out : source
	}
	if (isRecord(source)) {
		const uri = source.uri ?? source.url ?? source.src
		const rewritten = rewriteUriMaybe(uri, staticHint, aggressive)
		if (typeof rewritten === 'string' && rewritten && rewritten !== uri) {
			const newSource = { ...source }
			if (
				'uri' in newSource ||
				typeof source.uri === 'string' ||
				!('url' in newSource)
			)
				newSource.uri = rewritten
			if ('url' in newSource) newSource.url = rewritten
			if ('src' in newSource) newSource.src = rewritten
			return newSource
		}
	}
	return source
}

function freezeProps(props: any, aggressive = false): any {
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

	const staticHint =
		pickStaticUri(props) ??
		pickStaticUri(props.item) ??
		pickStaticUri(props.gif) ??
		pickStaticUri(props.data) ??
		pickStaticUri(props.result) ??
		pickStaticUri(props.asset) ??
		pickStaticUri(props.category)

	if ('source' in props) {
		const newSource = freezeSourceValue(props.source, staticHint, aggressive)
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
		'thumbnailUrl',
	]) {
		const v = props[key]
		if (typeof v === 'string') {
			const rewritten = rewriteUriMaybe(v, staticHint, aggressive)
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
			const frozenBag = freezeProps(bag, aggressive)
			if (frozenBag !== bag) ensure()[bagKey] = frozenBag
		} else if (Array.isArray(bag) || typeof bag === 'string') {
			const frozenBag = freezeSourceValue(bag, staticHint, aggressive)
			if (frozenBag !== bag) ensure()[bagKey] = frozenBag
		}
	}

	for (const itemKey of [
		'item',
		'gif',
		'data',
		'result',
		'asset',
		'category',
	]) {
		const item = props[itemKey]
		if (isRecord(item)) {
			const nextItem = freezeProps(item, aggressive)
			if (nextItem !== item) ensure()[itemKey] = nextItem
		}
	}

	return next
}

function freezeTree(node: any, aggressive = false, depth = 0): any {
	if (node == null || depth > 16) return node

	if (Array.isArray(node)) {
		let changed = false
		const out = node.map(child => {
			const next = freezeTree(child, aggressive, depth + 1)
			if (next !== child) changed = true
			return next
		})
		return changed ? out : node
	}

	if (!React.isValidElement(node)) return node

	const el = node as any
	const props = el.props
	if (!isRecord(props)) return el

	const nextProps = freezeProps(props, aggressive)
	let childChanged = false
	let nextChildren = props.children

	if (props.children != null) {
		nextChildren = freezeTree(props.children, aggressive, depth + 1)
		if (nextChildren !== props.children) childChanged = true
	}

	if (nextProps === props && !childChanged) return el

	const finalProps = nextProps === props ? { ...props } : { ...nextProps }
	if (childChanged) finalProps.children = nextChildren

	try {
		return React.cloneElement(el, finalProps)
	} catch {
		return el
	}
}

function wrapRenderResult(result: any): any {
	try {
		return freezeTree(result, gifPickerRenderDepth > 0)
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
	const lower = name.toLowerCase()
	if (
		lower.includes('gif') &&
		(lower.includes('pick') ||
			lower.includes('picker') ||
			lower.includes('category') ||
			lower.includes('favorite') ||
			lower.includes('result'))
	)
		return true
	if (lower.includes('favorite') && lower.includes('gif')) return true
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
		const unpatch = afterLoose(
			parent,
			key,
			function (this: any, result: any, ...args: any[]) {
				void args
				void this
				return wrapRenderResult(result)
			},
		)
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
									/shouldAnimate|getShouldAnimate|isAutoplay|autoplay|getAnimate/i.test(
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
}

function extractSourceUri(props: any): string | undefined {
	if (!isRecord(props)) return undefined
	const src = props.source
	if (typeof src === 'string' && src) return src
	if (Array.isArray(src)) {
		for (const item of src) {
			if (typeof item === 'string' && item) return item
			if (isRecord(item)) {
				const u = item.uri ?? item.url ?? item.src
				if (typeof u === 'string' && u) return u
			}
		}
	}
	if (isRecord(src)) {
		const u = src.uri ?? src.url ?? src.src
		if (typeof u === 'string' && u) return u
	}
	for (const k of ['uri', 'url', 'src', 'imageUrl', 'gifUrl', 'previewUrl']) {
		const v = props[k]
		if (typeof v === 'string' && v) return v
	}
	return undefined
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
				const aggressive = gifPickerRenderDepth > 0
				if (isRecord(props)) {
					const sourceUri = extractSourceUri(props)
					if (isHttpUrl(sourceUri)) {
						let isProviderUri = false
						try {
							isProviderUri = isKnownGifProviderHost(
								new URL(sourceUri).hostname,
							)
						} catch {}

						const shouldInspect =
							aggressive || isAnimatedMediaUri(sourceUri) || isProviderUri

						if (shouldInspect) {
							const nextProps = freezeProps(props, aggressive || isProviderUri)
							if (nextProps !== props) {
								return orig.call(this, type, nextProps, ...children)
							}
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

function wrapRenderFunctionsForDepth(cleanup: Cleanup): void {
	const names = [
		'GIFPicker',
		'GIFPickerItemView',
		'GIFPickerResultItem',
		'GIFPickerResultsList',
		'GIFPickerCategoryView',
		'GIFPickerCategoriesPage',
		'GIFPickerSearchSuggestions',
		'GIFPickerNoResults',
		'GIFPickerHeader',
		'GIFPickerFavorites',
		'GIFPickerFavoriteItem',
	]

	for (const name of names) {
		try {
			cleanup(
				getModules(
					withName(name),
					(m: any) => {
						try {
							if (!isRecord(m)) return
							const wrap = (obj: any, key: string) => {
								const fn = obj?.[key]
								if (typeof fn !== 'function' || patchedFns.has(fn)) return
								const fname = String(fn.displayName ?? fn.name ?? key ?? '')
								if (
									!looksLikeGifPickerComponentName(fname) &&
									key !== 'default'
								)
									return
								if (
									key === 'default' &&
									!looksLikeGifPickerComponentName(fname)
								)
									return
								patchedFns.add(fn)
								;(obj as any)[key] = function (this: any, ...args: any[]) {
									gifPickerRenderDepth++
									try {
										const res = fn.apply(this, args)
										return wrapRenderResult(res)
									} finally {
										gifPickerRenderDepth--
									}
								}
								try {
									;(obj as any)[key].displayName =
										(fn as any).displayName ?? (fn as any).name
								} catch {}
								cleanup(() => {
									try {
										;(obj as any)[key] = fn
									} catch {}
								})
							}
							for (const k of Object.keys(m)) wrap(m, k)
							if (m.default) wrap(m, 'default')
						} catch {}
					},
					{ returnNamespace: true },
				),
			)
		} catch {}
	}
}

export default plugin({
	start({ cleanup }) {
		wrapRenderFunctionsForDepth(cleanup)

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
		debugLogOnce('init', 'freeze-gif-picker started')
	},
})
