import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
} from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { findGifPickerClasses, forceFavorites } from './shared'

type LooseInstead = (
	parent: Record<string, any>,
	key: string,
	hook: (this: any, args: any[], original: (...args: any[]) => any) => any,
) => () => void

const insteadLoose = instead as unknown as LooseInstead

const gifPickerFilter = createFilterGenerator<[]>(
	(_args, _id, exports) => findGifPickerClasses(exports).length > 0,
	() => 'instantFavGif.picker',
	FilterScopes.Initialized,
)

const patched = new Set<Record<string, any>>()

export default plugin({
	start({ cleanup }) {
		cleanup(
			getModules(
				gifPickerFilter(),
				(exports: unknown) => {
					for (const component of findGifPickerClasses(exports)) {
						if (patched.has(component)) continue
						patched.add(component)

						const proto = component.prototype
						if (!proto || typeof proto.render !== 'function') continue

						try {
							cleanup(
								insteadLoose(proto, 'render', function (args, original) {
									// Discord picks the first category from this state during render.
									forceFavorites(this)
									return original.apply(this, args)
								}),
							)
						} catch {}
					}
				},
				{ returnNamespace: true, max: 5 },
			),
		)
	},
})
