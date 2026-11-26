import {
	describeElement,
	findFavoritePress,
	findGifPickerComponents,
} from './shared'

function check(name: string, actual: unknown, expected: unknown): void {
	if (actual !== expected)
		throw new Error(`${name}:\n  got  ${actual}\n  want ${expected}`)
}

const Target = Object.assign(function GIFPickerCategoryView() {}, {
	displayName: 'GIFPickerCategoryView',
})
const found: unknown[] = []
findGifPickerComponents({ default: { nested: { Target } } }, found)
check('finds the mobile GIF picker component', found.length, 1)

const ignored: unknown[] = []
findGifPickerComponents(
	{ GifPickerUtils: () => {}, GIFPickerResultTypes: {} },
	ignored,
)
check('ignores non-component GIF picker exports', ignored.length, 0)

let pressed = false
const favoriteTile = {
	props: {
		accessibilityLabel: 'Category, Favorites',
		onPress: () => {
			pressed = true
		},
	},
}
const press = findFavoritePress(favoriteTile)
check('finds the favorites press handler', typeof press, 'function')
press?.()
check('press opens favorites', pressed, true)

const nested = { props: { children: [favoriteTile] } }
check(
	'finds the press handler in children',
	findFavoritePress(nested) !== undefined,
	true,
)

check(
	'ignores search favorites',
	findFavoritePress({
		props: {
			accessibilityLabel: 'Search Favorites',
			onPress: () => {},
		},
	}),
	undefined,
)

check(
	'ignores other categories',
	findFavoritePress({
		props: {
			accessibilityLabel: 'Category, Trending GIFs',
			onPress: () => {},
		},
	}),
	undefined,
)

check(
	'describes the element for diagnostics',
	describeElement(favoriteTile).includes('Category, Favorites'),
	true,
)
