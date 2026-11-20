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

function patchSetNativeProps(cleanup: Cleanup): void {
	try {
		cleanup(
			getModules(
				(m: any) => {
					if (!m || typeof m !== 'object') return false
					const keys = Object.keys(m)
					return keys.some(k => /Image|View|Native/i.test(k))
				},
				(m: any) => {
					try {
						if (!m || typeof m !== 'object') return
						const targets = [m, m.default].filter(
							(t: any) => t && typeof t === 'object',
						)
						for (const t of targets) {
							const setNativeProps = t.setNativeProps
							if (
								typeof setNativeProps !== 'function' ||
								patchedFns.has(setNativeProps)
							)
								continue
							patchedFns.add(setNativeProps)
							t.setNativeProps = function patchedSetNativeProps(
								thisArg: any,
								props: any,
							) {
								try {
									if (props && typeof props === 'object') {
										const frozen = freezeElementProps(props)
										if (frozen !== props)
											return setNativeProps.call(thisArg, frozen)
									}
								} catch {}
								return setNativeProps.call(thisArg, props)
							}
							cleanup(() => {
								try {
									t.setNativeProps = setNativeProps
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

function patchReactNativeImage(cleanup: Cleanup): void {
	try {
		cleanup(
			getModules(
				withName('Image'),
				(m: any) => {
					try {
						if (!m || typeof m !== 'object') return
						const targets = [m, m.default].filter(
							(t: any) => t && typeof t === 'object',
						)
						for (const t of targets) {
							// Einige RN-Builds exportieren Image als Klasse/Component mit createElement/setNativeProps intern.
							for (const key of Object.keys(t)) {
								const val = (t as any)[key]
								if (typeof val !== 'function' || patchedFns.has(val)) continue
								const name = String(
									(val as any).displayName ?? (val as any).name ?? key,
								)
								if (
									key !== 'createElement' &&
									key !== 'setNativeProps' &&
									!/createElement|setNativeProps/i.test(key)
								)
									continue
								patchedFns.add(val)
								const orig = val
								;(t as any)[key] = function patchedMediaFn(
									thisArg: any,
									...a: any[]
								) {
									try {
										// createElement(Image, props, ...) -> props an Index 1
										// setNativeProps(props) -> props an Index 0
										const isCreateElement =
											key === 'createElement' || /createElement/i.test(key)
										const propsIndex = isCreateElement ? 1 : 0
										if (a[propsIndex] && typeof a[propsIndex] === 'object') {
											const frozen = freezeElementProps(a[propsIndex])
											if (frozen !== a[propsIndex]) {
												const nextArgs = [...a]
												nextArgs[propsIndex] = frozen
												return orig.apply(thisArg, nextArgs)
											}
										}
									} catch {}
									return orig.apply(thisArg, a)
								}
								cleanup(() => {
									try {
										;(t as any)[key] = orig
									} catch {}
								})
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
		patchSetNativeProps(cleanup)
		patchReactNativeImage(cleanup)
		debugLogOnce('started', 'freeze-gif-picker active')
	},
})
