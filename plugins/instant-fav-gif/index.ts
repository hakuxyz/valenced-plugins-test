import { onFluxEventDispatched } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
} from '@valenced/modules/finders/filters'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { findFavoriteCategorySelect, findGifPickerComponents } from './shared'

const pickerFilter = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		const found: unknown[] = []
		findGifPickerComponents(exports, found)
		return found.length > 0
	},
	() => 'instantFavGif.mobilePicker',
	FilterScopes.All,
)

const hooked = new Set<unknown>()
let selected = false
let selectedAt = 0

function selectFavoritesOnce(element: any): any {
	const select = findFavoriteCategorySelect(element)
	if (!select || selected) return element
	selected = true
	selectedAt = Date.now()
	console.log('[instant-fav-gif] selected favorites')
	setTimeout(() => {
		try {
			select()
		} catch {}
	}, 0)
	return element
}

export default plugin({
	start({ cleanup }) {
		cleanup(
			onFluxEventDispatched('EXPRESSION_PICKER_OPEN', () => {
				if (Date.now() - selectedAt > 200) selected = false
			}),
		)
		cleanup(
			getModules(
				pickerFilter(),
				(exports: unknown) => {
					const found: unknown[] = []
					findGifPickerComponents(exports, found)
					for (const component of found) {
						if (hooked.has(component)) continue
						hooked.add(component)
						try {
							cleanup(afterJSX(component as never, selectFavoritesOnce))
						} catch {}
					}
				},
				{ returnNamespace: true },
			),
		)
	},
})
