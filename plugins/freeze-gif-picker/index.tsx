import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
} from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'

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

const ANIMATED_THUMBNAIL_NAME = 'shouldUseAnimatedWebPThumbnail'

const animatedThumbnailFilter = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		if (!isRecord(exports)) return false
		const parents = isRecord(exports.default)
			? [exports, exports.default]
			: [exports]
		return parents.some(parent =>
			Object.keys(parent).some(key => {
				const value = parent[key]
				return (
					typeof value === 'function' && value.name === ANIMATED_THUMBNAIL_NAME
				)
			}),
		)
	},
	() => 'freezeGifPicker.animatedThumbnail',
	FilterScopes.Initialized,
)

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
										`gifautoplay:${key}:result`,
										'GifAutoPlay original',
										key,
										String(result),
									)
									return false
								}),
							)
							logOnce(`gifautoplay:${key}:patched`, 'patched GifAutoPlay', key)
						} catch {}
					}
				},
				{ returnNamespace: true },
			),
		)

		const patchedFunctions = new Set<(...args: any[]) => any>()
		cleanup(
			getModules(
				animatedThumbnailFilter(),
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
								if (original.name !== ANIMATED_THUMBNAIL_NAME) continue
								if (patchedFunctions.has(original)) continue
								ensureWritable(parent, key)
								patchedFunctions.add(original)
								cleanup(insteadLoose(parent, key, () => false))
								logOnce(
									'animated:patched',
									'patched animated thumbnail selector',
									key,
								)
							} catch {}
						}
					}
				},
				{ returnNamespace: true },
			),
		)
	},
})
