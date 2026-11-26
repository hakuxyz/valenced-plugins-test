import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
} from '@valenced/modules/finders/filters'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { findFavoritePress, findNamed } from './shared'

const PICKER_NAMES = ['GIFPickerCategoryView', 'GIFPickerCategoriesPage']

// shortcut: a 1s gap marks a new picker opening, replace if a real open event is exposed.
const SESSION_GAP_MS = 1000

const pickerFilter = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		const found: unknown[] = []
		findNamed(exports, PICKER_NAMES, found)
		return found.length > 0
	},
	() => 'instantFavGif.mobilePicker',
	FilterScopes.All,
)

const hooked = new Set<unknown>()
let lastCategoryViewAt = 0
let openedFavorites = false

function openFavoritesOnce(element: any): any {
	const now = Date.now()
	if (now - lastCategoryViewAt > SESSION_GAP_MS) openedFavorites = false
	lastCategoryViewAt = now
	if (openedFavorites) return element

	const onPress = findFavoritePress(element)
	if (!onPress) return element
	openedFavorites = true
	console.log('[instant-fav-gif] opening favorites')
	setTimeout(() => {
		try {
			onPress()
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
					findNamed(exports, PICKER_NAMES, found)
					for (const component of found) {
						if (hooked.has(component)) continue
						hooked.add(component)
						try {
							cleanup(afterJSX(component as never, openFavoritesOnce))
							console.log('[instant-fav-gif] hooked picker category')
						} catch {}
					}
				},
				{ returnNamespace: true },
			),
		)
	},
})
