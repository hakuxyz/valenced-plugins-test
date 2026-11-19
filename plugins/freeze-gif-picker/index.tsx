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
}

const STATIC_KEYS = [
	'still',
	'staticUrl',
	'staticURL',
	'static_url',
	'poster',
	'posterUrl',
	'posterURL',
	'thumbnail',
	'thumbnailUrl',
	'thumbnailURL',
	'preview',
	'previewUrl',
	'previewURL',
	'previewSrc',
] as const

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null
}

function pickStaticUri(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined
	for (const key of STATIC_KEYS) {
		const v = value[key]
		if (typeof v === 'string' && v) return v
		if (isRecord(v)) {
			const nested = pickStaticUri(v)
			if (nested) return nested
			if (typeof v.uri === 'string' && v.uri) return v.uri
			if (typeof v.url === 'string' && v.url) return v.url
		}
	}
	return undefined
}

function looksAnimatedUri(uri: unknown): boolean {
	if (typeof uri !== 'string') return false
	return /\.gif(?:[?#]|$)/i.test(uri) || /format=gif/i.test(uri)
}

function freezeProps(props: any): any {
	if (!isRecord(props)) return props

	let next: any = props
	const ensure = () => {
		if (next === props) next = { ...props }
		return next
	}

	for (const [key, value] of Object.entries(DISABLE_PROPS)) {
		if (key in props) ensure()[key] = value
	}

	// If a component explicitly controls animation via a function/flag,
	// try to hint "not focused/visible" states commonly used by pickers.
	if ('isFocused' in props && props.isFocused === true)
		ensure().isFocused = false
	if ('focused' in props && props.focused === true) ensure().focused = false
	if ('isVisible' in props && props.isVisible === true)
		ensure().isVisible = false

	// Prefer a static preview/still when available for known gif item shapes.
	const staticUri =
		pickStaticUri(props.item) ??
		pickStaticUri(props.gif) ??
		pickStaticUri(props.media) ??
		pickStaticUri(props.asset) ??
		pickStaticUri(props.source) ??
		pickStaticUri(props)

	if (staticUri) {
		if (isRecord(props.source)) {
			const uri = props.source.uri ?? props.source.url
			if (looksAnimatedUri(uri) && uri !== staticUri) {
				ensure().source = { ...props.source, uri: staticUri, url: staticUri }
			}
		} else if (typeof props.src === 'string' && looksAnimatedUri(props.src)) {
			ensure().src = staticUri
		} else if (typeof props.uri === 'string' && looksAnimatedUri(props.uri)) {
			ensure().uri = staticUri
		} else if (typeof props.url === 'string' && looksAnimatedUri(props.url)) {
			ensure().url = staticUri
		}
	}

	// Also disable animation props on nested common prop bags.
	for (const bagKey of [
		'imageProps',
		'videoProps',
		'playerProps',
		'animatedProps',
	]) {
		const bag = props[bagKey]
		if (isRecord(bag)) {
			const frozenBag = freezeProps(bag)
			if (frozenBag !== bag) ensure()[bagKey] = frozenBag
		}
	}

	return next
}

const seen = new WeakSet<object>()

function freezeTree(node: any, depth = 0): any {
	if (node == null || depth > 12) return node

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

		// Avoid patching things that are clearly not components.
		const name = fn.displayName ?? fn.name ?? ''
		if (!name && key !== 'default' && !GIF_PICKER_NAMES.has(key)) return

		patchedFns.add(fn)
		const unpatch = afterLoose(parent, key, (result, ..._args) =>
			wrapRenderResult(result),
		)
		cleanup(unpatch)
	} catch {}
}

function scanNamespace(ns: any, cleanup: Cleanup): void {
	if (!isRecord(ns)) return

	const candidates = new Set<string>()
	for (const key of Object.keys(ns)) candidates.add(key)
	if ('default' in ns) candidates.add('default')

	for (const key of candidates) {
		const value = ns[key]
		if (typeof value === 'function') {
			const name = value.displayName ?? value.name ?? key
			if (GIF_PICKER_NAMES.has(name) || GIF_PICKER_NAMES.has(key)) {
				patchFunctionComponent(ns, key, cleanup)
			}
		} else if (isRecord(value)) {
			for (const innerKey of Object.keys(value)) {
				const inner = value[innerKey]
				if (typeof inner === 'function') {
					const name = inner.displayName ?? inner.name ?? innerKey
					if (GIF_PICKER_NAMES.has(name) || GIF_PICKER_NAMES.has(innerKey)) {
						patchFunctionComponent(value, innerKey, cleanup)
					}
				}
			}
		}
	}

	// Fallback: if namespace itself is a function component export shape.
	if (typeof ns.default === 'function') {
		const name = ns.default.displayName ?? ns.default.name ?? ''
		if (GIF_PICKER_NAMES.has(name)) {
			patchFunctionComponent(ns, 'default', cleanup)
		}
	}
}

export default plugin({
	start({ cleanup }) {
		for (const name of GIF_PICKER_NAMES) {
			try {
				cleanup(
					getModules(withName(name), (m: any) => scanNamespace(m, cleanup), {
						returnNamespace: true,
					}),
				)
			} catch {}
		}

		// Broader fallback: some builds may expose components differently.
		try {
			cleanup(
				getModules(
					(m: any) => {
						try {
							if (!m || typeof m !== 'object') return false
							const names = [m.default?.name, m.default?.displayName]
							for (const n of names)
								if (n && GIF_PICKER_NAMES.has(n)) return true
							for (const [k, v] of Object.entries(m)) {
								if (GIF_PICKER_NAMES.has(k)) return true
								if (typeof v === 'function') {
									const fnName = (v as any).displayName ?? (v as any).name
									if (fnName && GIF_PICKER_NAMES.has(fnName)) return true
								}
							}
							return false
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
