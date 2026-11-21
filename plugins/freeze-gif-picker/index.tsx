import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
} from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { cloneElement } from 'react'
import type { ElementType, ReactElement } from 'react'

type Cleanup = (...fns: Array<() => unknown>) => void

type LooseInstead = (
	parent: Record<string, any>,
	key: string,
	hook: (this: any, args: any[], original: (...args: any[]) => any) => any,
) => () => void

const insteadLoose = instead as unknown as LooseInstead

function isRecord(value: unknown): value is Record<string, any> {
	return value !== null && typeof value === 'object'
}

function safeParents(exports: unknown): Record<string, any>[] {
	try {
		if (!isRecord(exports)) return []
		const parents = [exports]
		try {
			const fallback = exports.default
			if (isRecord(fallback)) parents.push(fallback)
		} catch {}
		return parents
	} catch {
		return []
	}
}

/** Metro re-exports members as getters. Make them writable before patching. */
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

const logged = new Set<string>()

function logOnce(key: string, ...args: unknown[]): void {
	if (logged.has(key)) return
	logged.add(key)
	try {
		console.log('[freeze-gif-picker]', ...args)
	} catch {}
}

const gifAutoPlayFilter = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		try {
			if (!isRecord(exports)) return false
			let target: unknown
			try {
				target = exports.GifAutoPlay
			} catch {
				return false
			}
			return (
				isRecord(target) &&
				typeof target.getSetting === 'function' &&
				typeof target.useSetting === 'function'
			)
		} catch {
			return false
		}
	},
	() => 'freezeGifPicker.gifAutoPlay',
	FilterScopes.Initialized,
)

function installGifAutoPlayPatch(cleanup: Cleanup): void {
	cleanup(
		getModules(
			gifAutoPlayFilter(),
			(exports: unknown) => {
				try {
					if (!isRecord(exports)) return
					let target: unknown
					try {
						target = exports.GifAutoPlay
					} catch {
						return
					}
					if (!isRecord(target)) return

					for (const key of ['getSetting', 'useSetting'] as const) {
						const fn = target[key]
						if (typeof fn !== 'function') continue
						try {
							ensureWritable(target, key)
							cleanup(
								insteadLoose(target, key, function (args, original) {
									const result = original.apply(this, args)
									logOnce(
										`gifautoplay:${key}`,
										'GifAutoPlay original',
										key,
										String(result),
									)
									return false
								}),
							)
						} catch {}
					}
				} catch {}
			},
			{ returnNamespace: true },
		),
	)
}

const AUTOPLAY_FUNCTION_NAMES = new Set([
	'shouldUseAnimatedWebPThumbnail',
	'shouldAutoPlayGif',
	'shouldAutoplayGif',
])

const autoplayFunctionFilter = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		try {
			return safeParents(exports).some(parent =>
				Object.keys(parent).some(key => {
					try {
						const value = parent[key]
						return (
							typeof value === 'function' &&
							AUTOPLAY_FUNCTION_NAMES.has(value.name)
						)
					} catch {
						return false
					}
				}),
			)
		} catch {
			return false
		}
	},
	() => 'freezeGifPicker.autoplayFunctions',
	FilterScopes.All,
)

const patchedFunctions = new Set<(...args: any[]) => any>()

function patchAutoplayFunctions(): void {
	try {
		getModules(
			autoplayFunctionFilter(),
			(exports: unknown) => {
				for (const parent of safeParents(exports)) {
					let keys: string[]
					try {
						keys = Object.keys(parent)
					} catch {
						continue
					}
					for (const key of keys) {
						try {
							const original = parent[key]
							if (typeof original !== 'function') continue
							if (!AUTOPLAY_FUNCTION_NAMES.has(original.name)) continue
							if (patchedFunctions.has(original)) continue
							ensureWritable(parent, key)
							patchedFunctions.add(original)
							insteadLoose(parent, key, () => false)
							logOnce(
								`fn:${original.name}`,
								'patched autoplay function',
								original.name,
								key,
							)
						} catch {}
					}
				}
			},
			{ returnNamespace: true },
		)
	} catch {}
}

const GIF_ITEM_NAME = 'GIFPickerItemView'

function matchesName(value: unknown, name: string): boolean {
	try {
		if (typeof value === 'function') {
			return value.name === name || (value as any).displayName === name
		}
		if (!isRecord(value)) return false
		return (
			value.displayName === name ||
			(value.type ? matchesName(value.type, name) : false)
		)
	} catch {
		return false
	}
}

function findNamed(
	value: unknown,
	name: string,
	output: ElementType[],
	depth = 0,
): void {
	if (depth > 4) return
	if (matchesName(value, name)) {
		output.push(value as ElementType)
		return
	}
	if (!isRecord(value)) return
	let keys: string[]
	try {
		keys = Object.keys(value)
	} catch {
		return
	}
	for (const key of keys) {
		if (key === '_owner' || key === '_store' || key === '_self') continue
		try {
			findNamed(value[key], name, output, depth + 1)
		} catch {}
	}
}

const gifPickerItemFilter = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		try {
			const found: ElementType[] = []
			findNamed(exports, GIF_ITEM_NAME, found)
			return found.length > 0
		} catch {
			return false
		}
	},
	() => 'freezeGifPicker.gifPickerItem',
	FilterScopes.All,
)

function isHttpUrl(value: unknown): value is string {
	return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function isStillUrl(value: unknown): value is string {
	return isHttpUrl(value) && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(value)
}

function findStillSource(value: unknown, depth = 0): string | undefined {
	if (depth > 2) return undefined
	if (isHttpUrl(value) && /\.(?:jpe?g|png)(?:[?#]|$)/i.test(value)) {
		return value
	}
	if (!isRecord(value)) return undefined

	for (const [key, nested] of Object.entries(value)) {
		if (
			/preview|still|static|thumbnail|thumb|poster/i.test(key) &&
			isStillUrl(nested)
		) {
			return nested
		}
	}
	for (const key of ['url', 'src', 'uri', 'gifSrc', 'srcUrl'] as const) {
		if (
			isHttpUrl(value[key]) &&
			/\.(?:jpe?g|png)(?:[?#]|$)/i.test(value[key])
		) {
			return value[key]
		}
	}
	for (const nested of Object.values(value)) {
		const found = findStillSource(nested, depth + 1)
		if (found) return found
	}
	return undefined
}

function freezeItem(
	element: ReactElement<Record<string, any>>,
): ReactElement<Record<string, any>> {
	try {
		const item = element.props?.item
		if (!isRecord(item)) return element

		logOnce('item:keys', 'GIF item keys', Object.keys(item).sort().join(','))
		for (const [key, value] of Object.entries(item)) {
			if (typeof value === 'string') {
				logOnce(`item:value:${key}`, 'GIF item value', key, value.slice(0, 220))
			}
		}

		const still = findStillSource(item)
		if (!still) return element

		const next: Record<string, any> = { ...item, gifSrc: still }
		if (typeof item.src === 'string') next.src = still
		if ('isAnimated' in item) next.isAnimated = false
		if ('animated' in item) next.animated = false

		logOnce(
			'item:frozen',
			'froze GIF item with still source',
			String(item.gifSrc).slice(0, 160),
			'->',
			still.slice(0, 160),
		)
		return cloneElement(element, { item: next })
	} catch {
		return element
	}
}

export default plugin({
	start({ cleanup }) {
		installGifAutoPlayPatch(cleanup)
		patchAutoplayFunctions()

		let hooksInstalled = false

		function installGifItemHook(): void {
			if (hooksInstalled) return
			try {
				cleanup(
					getModules(
						gifPickerItemFilter(),
						(exports: unknown) => {
							try {
								if (hooksInstalled) return
								const found: ElementType[] = []
								findNamed(exports, GIF_ITEM_NAME, found)
								if (found.length === 0) return
								hooksInstalled = true

								let autoplayPatched = false
								for (const component of found) {
									try {
										const unpatch = afterJSX(component as never, element => {
											try {
												if (!autoplayPatched) {
													autoplayPatched = true
													patchAutoplayFunctions()
												}
												return freezeItem(
													element as ReactElement<Record<string, any>>,
												)
											} catch {
												return element
											}
										})
										cleanup(unpatch)
										logOnce('gifitem:hook', 'installed GIF item hook')
									} catch {}
								}
							} catch {}
						},
						{ returnNamespace: true },
					),
				)
			} catch {}
		}

		installGifItemHook()
	},
})
