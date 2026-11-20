import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
} from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { cloneElement } from 'react'
import type { ElementType, ReactElement } from 'react'

type LooseInstead = (
	parent: Record<string, any>,
	key: string,
	hook: (this: any, args: any[], original: (...args: any[]) => any) => any,
) => () => void

const insteadLoose = instead as unknown as LooseInstead

function isRecord(value: unknown): value is Record<string, any> {
	return value !== null && typeof value === 'object'
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
		if (!isRecord(exports)) return false
		const target = (exports as Record<string, any>).GifAutoPlay
		return (
			isRecord(target) &&
			typeof target.getSetting === 'function' &&
			typeof target.useSetting === 'function'
		)
	},
	() => 'freezeGifPicker.gifAutoPlay',
	FilterScopes.Initialized,
)

const AUTOPLAY_FUNCTION_NAMES = new Set([
	'shouldUseAnimatedWebPThumbnail',
	'shouldAutoPlayGif',
	'shouldAutoplayGif',
])

const autoplayFunctionFilter = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		if (!isRecord(exports)) return false
		const parents = isRecord(exports.default)
			? [exports, exports.default]
			: [exports]
		return parents.some(parent =>
			Object.keys(parent).some(key => {
				const value = parent[key]
				return (
					typeof value === 'function' && AUTOPLAY_FUNCTION_NAMES.has(value.name)
				)
			}),
		)
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
				if (!isRecord(exports)) return
				const parents = isRecord(exports.default)
					? [exports, exports.default]
					: [exports]
				for (const parent of parents) {
					for (const key of Object.keys(parent)) {
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
	if (typeof value !== 'function') return false
	return value.name === name || (value as any).displayName === name
}

function findNamed(
	value: unknown,
	name: string,
	output: ElementType[],
	depth = 0,
): void {
	if (depth > 3) return
	if (matchesName(value, name)) {
		output.push(value as ElementType)
		return
	}
	if (!isRecord(value)) return
	for (const key of Object.keys(value)) {
		if (key === '_owner' || key === '_store' || key === '_self') continue
		try {
			findNamed(value[key], name, output, depth + 1)
		} catch {}
	}
}

const gifPickerItemFilter = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		const found: ElementType[] = []
		findNamed(exports, GIF_ITEM_NAME, found)
		return found.length > 0
	},
	() => 'freezeGifPicker.gifPickerItem',
	FilterScopes.Initialized,
)

function freezeItem(
	element: ReactElement<Record<string, any>>,
): ReactElement<Record<string, any>> {
	const item = element.props?.item
	if (!isRecord(item)) return element
	const animated = item.gifSrc
	const still = item.src
	if (
		typeof animated !== 'string' ||
		typeof still !== 'string' ||
		animated === still
	) {
		return element
	}
	logOnce(
		'item:frozen',
		'froze GIF item',
		animated.slice(0, 160),
		'->',
		still.slice(0, 160),
	)
	return cloneElement(element, { item: { ...item, gifSrc: still } })
}

export default plugin({
	start({ cleanup }) {
		cleanup(
			getModules(
				gifAutoPlayFilter(),
				(exports: unknown) => {
					if (!isRecord(exports)) return
					const target = (exports as Record<string, any>).GifAutoPlay
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
				},
				{ returnNamespace: true },
			),
		)

		let hooksInstalled = false
		cleanup(
			getModules(
				gifPickerItemFilter(),
				(exports: unknown) => {
					if (hooksInstalled) return
					const found: ElementType[] = []
					findNamed(exports, GIF_ITEM_NAME, found)
					if (found.length === 0) return
					hooksInstalled = true

					let autoplayPatched = false
					for (const component of found) {
						try {
							const unpatch = afterJSX(component as never, element => {
								if (!autoplayPatched) {
									autoplayPatched = true
									patchAutoplayFunctions()
								}
								return freezeItem(element as ReactElement<Record<string, any>>)
							})
							cleanup(unpatch)
							logOnce('gifitem:hook', 'installed GIF item hook')
						} catch {}
					}
				},
				{ returnNamespace: true },
			),
		)
	},
})
