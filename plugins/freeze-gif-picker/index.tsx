import { getModules } from '@valenced/modules/finders'
import * as React from 'react'
import type { AnyFunction } from '@valenced/utils/types'

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
const ANIMATION_PROPS: Record<string, any> = {
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

// native Media-Elemente, deren Animated-GIF/Video-Wiedergabe wir unterbinden wollen.
const MEDIA_TYPES = new Set([
	'Image',
	'Video',
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

function isMediaElement(type: any): boolean {
	if (type == null) return false
	const name =
		(type?.name ?? type?.displayName ?? typeof type === 'string') ? type : ''
	if (typeof name === 'string' && MEDIA_TYPES.has(name)) return true
	return false
}

function patchCreateElement(): () => void {
	const reactMod: any = React as any
	const orig = reactMod.createElement
	if (typeof orig !== 'function') return
	if (patchedFns.has(orig)) return
	patchedFns.add(orig)

	reactMod.createElement = function patchedCreateElement(
		type: any,
		props: any,
		...children: any[]
	) {
		try {
			if (isMediaElement(type)) {
				const frozen = freezeElementProps(props)
				if (frozen !== props) return orig.call(this, type, frozen, ...children)
			}
		} catch {}
		return orig.call(this, type, props, ...children)
	}

	return () => {
		reactMod.createElement = orig
	}
}

export default plugin({
	start({ cleanup }) {
		cleanup(patchCreateElement())

		// Auch GIF-Picker-Komponenten selbst (wenn gefunden) auf statisches Rendern zwingen.
		try {
			cleanup(
				getModules(
					(m: any) => {
						if (!m || typeof m !== 'object') return false
						const keys = Object.keys(m)
						return keys.some(
							k => GIF_PICKER_NAMES.has(k) || /GIFPicker|GifPicker/i.test(k),
						)
					},
					(m: any) => {
						try {
							for (const key of Object.keys(m)) {
								if (
									!GIF_PICKER_NAMES.has(key) &&
									!/GIFPicker|GifPicker/i.test(key)
								)
									continue
								const fn = (m as any)[key]
								if (typeof fn !== 'function') continue
								if (patchedFns.has(fn)) continue
								patchedFns.add(fn)

								;(m as any)[key] = function patchedComponent(
									this: any,
									props: any,
								) {
									try {
										const frozen = freezeElementProps(props)
										// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
										return (fn as AnyFunction).call(this, frozen)
									} catch {
										return (fn as AnyFunction).call(this, props)
									}
								}
							}
						} catch {}
					},
					{ returnNamespace: true },
				),
			)
		} catch {}

		debugLogOnce('started', 'freeze-gif-picker active')
	},
})
