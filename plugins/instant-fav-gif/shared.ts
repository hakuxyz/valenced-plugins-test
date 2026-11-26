export function isRecord(value: unknown): value is Record<string, any> {
	return (
		value !== null && (typeof value === 'object' || typeof value === 'function')
	)
}

const GIF_PICKER_COMPONENT = /^GIFPicker(?:[A-Z].*)?$/
const NON_COMPONENT_SUFFIX = /(Utils|Hooks|Types|Constants|Store)$/

export function isGifPickerComponent(value: unknown): boolean {
	if (typeof value !== 'function') return false
	const name = value.name || (value as any).displayName || ''
	return GIF_PICKER_COMPONENT.test(name) && !NON_COMPONENT_SUFFIX.test(name)
}

export function findGifPickerComponents(
	value: unknown,
	output: unknown[],
	depth = 0,
): void {
	if (depth > 4) return
	if (isGifPickerComponent(value)) {
		output.push(value)
		return
	}
	if (!isRecord(value)) return
	let keys: string[]
	try {
		keys = Object.keys(value)
	} catch {
		return
	}
	for (const key of keys) {
		if (key === '_owner' || key === '_store' || key === '_self') continue
		try {
			findGifPickerComponents(value[key], output, depth + 1)
		} catch {}
	}
}

const FAVORITES_CATEGORY = /category[^\n]{0,24}favorites/i

function hasFavoriteCategory(value: unknown, depth = 0): boolean {
	if (depth > 4) return false
	if (typeof value === 'string') return FAVORITES_CATEGORY.test(value)
	if (typeof value === 'function') return false
	if (Array.isArray(value)) {
		return value.some(item => hasFavoriteCategory(item, depth + 1))
	}
	if (!isRecord(value)) return false
	return Object.values(value).some(item => hasFavoriteCategory(item, depth + 1))
}

export function findFavoritePress(
	value: unknown,
	depth = 0,
): (() => void) | undefined {
	if (depth > 4) return undefined
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findFavoritePress(item, depth + 1)
			if (found) return found
		}
		return undefined
	}
	if (!isRecord(value)) return undefined

	const props = value.props
	if (isRecord(props)) {
		const onPress = props.onPress
		if (typeof onPress === 'function' && hasFavoriteCategory(props)) {
			return () => {
				onPress()
			}
		}
		const found = findFavoritePress(props.children, depth + 1)
		if (found) return found
	}
	return undefined
}
