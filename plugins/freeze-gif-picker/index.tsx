import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
} from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { afterJSX } from '@valenced/react/jsx-runtime'
import type { ElementType } from 'react'

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
	FilterScopes.Initialized,
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

function componentName(value: unknown): string {
	try {
		if (typeof value !== 'function' && !isRecord(value)) return ''
		const candidate = value as Record<string, any>
		return (
			candidate.displayName ??
			candidate.name ??
			(candidate.type ? componentName(candidate.type) : '') ??
			''
		)
	} catch {
		return ''
	}
}

function isComponentValue(value: unknown): boolean {
	if (typeof value === 'function') return true
	return (
		isRecord(value) &&
		('$$typeof' in value || 'type' in value || 'render' in value)
	)
}

function hasGifHint(value: unknown, depth = 0): boolean {
	if (depth > 2 || (!isRecord(value) && typeof value !== 'function')) {
		return false
	}
	if (/gif/i.test(componentName(value))) return true
	if (!isRecord(value)) return false
	return Object.keys(value).some(key => {
		if (key === '_owner' || key === '_store' || key === '_self') return false
		if (/gif/i.test(key)) return true
		try {
			return hasGifHint(value[key], depth + 1)
		} catch {
			return false
		}
	})
}

const gifComponentsFilter = createFilterGenerator<[]>(
	(_args, id, exports) => {
		try {
			if (typeof id === 'string' && /gif/i.test(id)) return true
		} catch {}
		return hasGifHint(exports)
	},
	() => 'freezeGifPicker.gifComponents',
	FilterScopes.Initialized,
)

function collectComponents(
	value: unknown,
	output: ElementType[],
	depth = 0,
): void {
	if (depth > 3 || output.length >= 8) return
	if (isComponentValue(value)) output.push(value as ElementType)
	if (!isRecord(value) || depth >= 3) return
	let keys: string[]
	try {
		keys = Object.keys(value)
	} catch {
		return
	}
	for (const key of keys) {
		if (key === '_owner' || key === '_store' || key === '_self') continue
		try {
			collectComponents(value[key], output, depth + 1)
			if (output.length >= 8) return
		} catch {}
	}
}

function installOneShotGifTrigger(cleanup: Cleanup): void {
	const triggers = new Set<ElementType>()
	const localUnpatches: Array<() => void> = []
	let triggered = false

	const removeTriggers = (): void => {
		for (const unpatch of localUnpatches.splice(0)) {
			try {
				unpatch()
			} catch {}
		}
	}
	cleanup(removeTriggers)

	cleanup(
		getModules(
			gifComponentsFilter(),
			(exports: unknown) => {
				if (triggered || triggers.size >= 6) return
				patchAutoplayFunctions()

				const found: ElementType[] = []
				collectComponents(exports, found)
				for (const component of found) {
					if (triggers.has(component)) continue
					if (triggers.size >= 4) break
					triggers.add(component)
					try {
						const unpatch = afterJSX(component as never, element => {
							if (!triggered) {
								triggered = true
								patchAutoplayFunctions()
								logOnce('giftrigger:render', 'GIF trigger rendered')
								setTimeout(removeTriggers, 0)
							}
							return element
						})
						localUnpatches.push(unpatch)
						logOnce(
							'giftrigger:found',
							'found GIF trigger component',
							componentName(component) || 'unnamed',
						)
					} catch {
						triggers.delete(component)
					}
				}
			},
			{ returnNamespace: true },
		),
	)
}

export default plugin({
	start({ cleanup }) {
		installGifAutoPlayPatch(cleanup)
		patchAutoplayFunctions()
		installOneShotGifTrigger(cleanup)
	},
})
