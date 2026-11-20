import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
} from '@valenced/modules/finders/filters'

function isRecord(value: unknown): value is Record<string, any> {
	return value !== null && typeof value === 'object'
}

const gifAutoPlayFilter = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		if (!isRecord(exports)) return false
		const target = (exports as Record<string, any>).GifAutoPlay
		return (
			isRecord(target) &&
			typeof target.getSetting === 'function' &&
			typeof target.updateSetting === 'function'
		)
	},
	() => 'freezeGifPicker.gifAutoPlay',
	FilterScopes.Initialized,
)

export default plugin({
	start({ cleanup }) {
		let target: Record<string, any> | undefined
		let previous: unknown
		let applied = false

		cleanup(
			getModules(
				gifAutoPlayFilter(),
				(exports: unknown) => {
					if (!isRecord(exports) || applied) return
					const candidate = (exports as Record<string, any>).GifAutoPlay
					if (!isRecord(candidate)) return
					try {
						previous = candidate.getSetting()
						candidate.updateSetting(false)
						target = candidate
						applied = true
					} catch {}
				},
				{ returnNamespace: true },
			),
		)

		cleanup(() => {
			if (!applied || !target) return
			try {
				target.updateSetting(previous)
			} catch {}
		})
	},
})
