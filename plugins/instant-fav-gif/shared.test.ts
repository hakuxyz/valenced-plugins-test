import { findFavoritePress, findNamed } from './shared'

function check(name: string, actual: unknown, expected: unknown): void {
	if (actual !== expected)
		throw new Error(`${name}:\n  got  ${actual}\n  want ${expected}`)
}

const Target = Object.assign(function Target() {}, {
	displayName: 'GIFPickerCategoryView',
})
const found: unknown[] = []
findNamed({ default: { nested: { Target } } }, ['GIFPickerCategoryView'], found)
check('finds the mobile category component', found.length, 1)

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
	'ignores other categories',
	findFavoritePress({
		props: {
			accessibilityLabel: 'Category, Trending GIFs',
			onPress: () => {},
		},
	}),
	undefined,
)
