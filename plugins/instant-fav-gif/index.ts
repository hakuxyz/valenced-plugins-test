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

function selectFavoritesOnce(element: any): any {
	const select = findFavoriteCategorySelect(element)
	if (!select) {
		selected = false
		return element
	}
	if (selected) return element
	selected = true
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
