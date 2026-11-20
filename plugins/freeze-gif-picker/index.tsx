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
	'GIFPickerSearchSuggestions',
	'GIFPickerNoResults',
	'GIFPicker',
	'GIFPickerHeader',
	'GIFPickerFavorites',
	'GIFPickerFavoriteItem',
])

// Props, die RN-Image/Video-ähnliche Komponenten zum Animieren/Abspielen veranlassen können.
const ANIMATION_PROPS: Record<string, boolean> = {
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

// RN-Host-Component-Namen (minimierte Builds nutzen Strings als type).
const MEDIA_HOST_NAMES = new Set([
	'Image',
	'Video',
	'RCTImageView',
	'ImageView',
	'AnimatedImage',
	'GifView',
	'AnimatedGif',
	'RNCView',
])

function debugLogOnce(_key: string, ...args: any[]) {
	try {
		console.log('[freeze-gif-picker]', ...args)
	} catch {}
}

const patchedFns = new WeakSet<AnyFunction>()

function freezeElementProps(props: any): any {
	if (props == null || typeof props !== 'object') return props

	const original = props as Record<string, any>
	let changed = false
	let next: Record<string, any> = original

	for (const [key, value] of Object.entries(ANIMATION_PROPS)) {
		if (key in original && original[key] !== value) {
			if (next === original) next = { ...original }
			next[key] = value
			changed = true
		}
	}

	// source unverändert übernehmen (URL pro User unterschiedlich), nur Animation stoppen.
	if ('source' in original && next === original) {
		next = { ...original }
		changed = true
		next.source = original.source
	}

	return changed ? next : props
}

function isMediaType(type: any): boolean {
	if (type == null) return false
	if (typeof type === 'string') {
		return MEDIA_HOST_NAMES.has(type)
	}
	const name = (type as any).name ?? (type as any).displayName ?? ''
	if (typeof name === 'string' && MEDIA_HOST_NAMES.has(name)) return true
	return false
}

function patchReactCreateElement(cleanup: Cleanup): void {
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
			if (isMediaType(type)) {
				const frozen = freezeElementProps(props)
				if (frozen !== props) return orig.call(this, frozen, ...children)
			}
		} catch {}
		return orig.call(this, type, props, ...children)
	}

	cleanup(() => {
		try {
			reactMod.createElement = orig
		} catch {}
	})
}

function patchReactNativeCreateElement(cleanup: Cleanup): void {
	try {
		cleanup(
			getModules(
				withName('createElement'),
				(m: any) => {
					try {
						if (!m || typeof m !== 'object') return
						const targets = [m, m.default].filter(
							(t: any) => t && typeof t === 'object',
						)
						for (const t of targets) {
							const orig = t.createElement
							if (typeof orig !== 'function' || patchedFns.has(orig)) continue
							patchedFns.add(orig)
							t.createElement = function patchedCreateElement(
								type: any,
								props: any,
								...children: any[]
							) {
								try {
									if (isMediaType(type)) {
										const frozen = freezeElementProps(props)
										if (frozen !== props)
											return orig.call(this, frozen, ...children)
									}
								} catch {}
								return orig.call(this, type, props, ...children)
							}
							cleanup(() => {
								try {
									t.createElement = orig
								} catch {}
							})
						}
					} catch {}
				},
				{ returnNamespace: true },
			),
		)
	} catch {}
}

function patchGifPickerComponents(cleanup: Cleanup): void {
	try {
		cleanup(
			getModules(
				withName('GIFPickerItemView'),
				(m: any) => {
					try {
						if (!m || typeof m !== 'object') return
						const targets = [m, m.default].filter(
							(t: any) => t && typeof t === 'object',
						)
						for (const t of targets) {
							for (const key of Object.keys(t)) {
								const fn = (t as any)[key]
								if (typeof fn !== 'function' || patchedFns.has(fn)) continue
								const name = String(
									(fn as any).displayName ?? (fn as any).name ?? key,
								)
								if (!GIF_PICKER_NAMES.has(name) && key !== 'default') continue
								if (key === 'default' && !GIF_PICKER_NAMES.has(name)) continue
								patchedFns.add(fn)

								;(t as any)[key] = function patchedComponent(
									thisArg: any,
									props: any,
								) {
									try {
										const frozen = freezeElementProps(props)
										return (fn as AnyFunction).call(thisArg, frozen)
									} catch {
										return (fn as AnyFunction).call(thisArg, props)
									}
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

export default plugin({
	start({ cleanup }) {
		patchReactCreateElement(cleanup)
		patchReactNativeCreateElement(cleanup)
		patchGifPickerComponents(cleanup)
		debugLogOnce('started', 'freeze-gif-picker active')
	},
})
