import { findGifPickerClasses, forceFavorites } from './shared'

class FakePicker {
	state = { resultType: null as string | null }
	props = { favorites: [] as string[] }

	renderHeaderContent(): void {}

	render(): void {}
}

function check(name: string, actual: unknown, expected: unknown): void {
	if (actual !== expected)
		throw new Error(`${name}:\n  got  ${actual}\n  want ${expected}`)
}

const found = findGifPickerClasses({ default: FakePicker })
check('finds the GIF picker class', found.length, 1)

const instance = new FakePicker()
forceFavorites(instance)
check('opens favorites', instance.state.resultType, 'Favorites')
