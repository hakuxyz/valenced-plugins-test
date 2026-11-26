import { findFavoriteCategorySelect, findGifPickerComponents } from './shared'

function check(name: string, actual: unknown, expected: unknown): void {
	if (actual !== expected)
		throw new Error(`${name}:\n  got  ${actual}\n  want ${expected}`)
}

const Picker = Object.assign(function GIFPicker() {}, {
	displayName: 'GIFPicker',
})
const found: unknown[] = []
findGifPickerComponents({ default: { nested: { Picker } } }, found)
check('finds the mobile GIF picker component', found.length, 1)

const ignored: unknown[] = []
findGifPickerComponents(
	{ GifPickerUtils: () => {}, GIFPickerResultTypes: {} },
	ignored,
)
check('ignores non-component GIF picker exports', ignored.length, 0)

let selectedItem: unknown
const favoriteTile = {
	props: {
		item: {
			type: 'Favorites',
			name: 'Favorites',
			src: 'https://example.invalid/favorites.png',
		},
		onSelectCategory: (item: unknown) => {
			selectedItem = item
		},
	},
}
const tree = { props: { children: [favoriteTile] } }
const select = findFavoriteCategorySelect(tree)
check('finds the favorites category handler', typeof select, 'function')
select?.()
check('passes the favorites item', selectedItem, favoriteTile.props.item)

check(
	'ignores other categories',
	findFavoriteCategorySelect({
		props: {
			item: { type: 'Trending GIFs', name: 'Trending GIFs' },
			onSelectCategory: () => {},
		},
	}),
	undefined,
)
