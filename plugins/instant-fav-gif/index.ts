import { onFluxEventDispatched } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
} from '@valenced/modules/finders/filters'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { createElement, useRef } from 'react'
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
const wrappers = new Map<unknown, any>()
let sessionSelected = false
let selectedAt = 0

function sessionWrapper(original: any): any {
	const cached = wrappers.get(original)
	if (cached) return cached
	const SessionPicker = (props: any) => {
		const mounted = useRef(false)
		if (!mounted.current) {
			mounted.current = true
			sessionSelected = false
			console.log('[instant-fav-gif] picker mounted')
		}
		return createElement(original, props)
	}
	wrappers.set(original, SessionPicker)
	return SessionPicker
}

function selectFavoritesOnce(element: any): any {
	const select = findFavoriteCategorySelect(element)
	if (!select || sessionSelected) return element
	sessionSelected = true
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
				if (Date.now() - selectedAt > 200) {
					sessionSelected = false
					console.log('[instant-fav-gif] picker reopened')
				}
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
							if (
								typeof component === 'function' &&
								component.name === 'GIFPicker'
							) {
								cleanup(
									afterJSX(component as never, (element: any) =>
										createElement(sessionWrapper(component), element.props),
									),
								)
							} else {
								cleanup(afterJSX(component as never, selectFavoritesOnce))
							}
						} catch {}
					}
				},
				{ returnNamespace: true },
			),
		)
	},
})
