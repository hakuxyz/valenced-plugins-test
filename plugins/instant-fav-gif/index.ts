import { ToastActionCreators } from '@valenced/discord/actions'
import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
} from '@valenced/modules/finders/filters'
import { afterJSX } from '@valenced/react/jsx-runtime'
import {
	componentName,
	describeElement,
	findFavoritePress,
	findGifPickerComponents,
} from './shared'

function toast(text: string): void {
	console.log('[instant-fav-gif]', text)
	try {
		ToastActionCreators.open('HV_IFG', { text, duration: 3000 })
	} catch {}
}

// shortcut: a 1s gap marks a new picker opening, replace if a real open event is exposed.
const SESSION_GAP_MS = 1000

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
const dumped = new Set<string>()
let reported = false
let lastCategoryViewAt = 0
let openedFavorites = false

function makeOpenFavoritesOnce(name: string): (element: any) => any {
	return (element: any): any => {
		const now = Date.now()
		if (now - lastCategoryViewAt > SESSION_GAP_MS) openedFavorites = false
		lastCategoryViewAt = now
		if (openedFavorites) return element

		const onPress = findFavoritePress(element)
		if (!onPress) {
			if (!dumped.has(name)) {
				dumped.add(name)
				toast(`IFG dump ${name}: ${describeElement(element)}`)
			}
			return element
		}
		openedFavorites = true
		toast('IFG favorites')
		setTimeout(() => {
			try {
				onPress()
			} catch {}
		}, 0)
		return element
	}
}

export default plugin({
	start({ cleanup }) {
		cleanup(
			getModules(
				pickerFilter(),
				(exports: unknown) => {
					const found: unknown[] = []
					findGifPickerComponents(exports, found)
					let added = 0
					for (const component of found) {
						if (hooked.has(component)) continue
						hooked.add(component)
						added++
						try {
							cleanup(
								afterJSX(
									component as never,
									makeOpenFavoritesOnce(componentName(component)),
								),
							)
						} catch {}
					}
					if (added > 0 && !reported) {
						reported = true
						toast(`IFG hooked ${componentName(found[0])}`)
					}
				},
				{ returnNamespace: true },
			),
		)
	},
})
