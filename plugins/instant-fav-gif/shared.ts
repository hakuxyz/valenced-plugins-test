function isRecord(value: unknown): value is Record<string, any> {
	return (
		value !== null && (typeof value === 'object' || typeof value === 'function')
	)
}

const GIF_PICKER_COMPONENT = /^GIFPicker(?:[A-Z].*)?$/
const NON_COMPONENT_SUFFIX = /(Utils|Hooks|Types|Constants|Store)$/

export function findGifPickerComponents(
	value: unknown,
	output: unknown[],
	depth = 0,
): void {
	if (depth > 4) return
	if (typeof value === 'function') {
		const name = value.name || (value as any).displayName || ''
		if (GIF_PICKER_COMPONENT.test(name) && !NON_COMPONENT_SUFFIX.test(name)) {
			output.push(value)
		}
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

const FAVORITES_NAME = /^favorites$/i

export function findFavoriteCategorySelect(
	value: unknown,
	depth = 0,
): (() => void) | undefined {
	if (depth > 6) return undefined
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findFavoriteCategorySelect(item, depth + 1)
			if (found) return found
		}
		return undefined
	}
	if (!isRecord(value)) return undefined

	const props = value.props
	if (isRecord(props) && typeof props.onSelectCategory === 'function') {
		const item = props.item
		if (isRecord(item)) {
			const name = item.name ?? item.type
			if (typeof name === 'string' && FAVORITES_NAME.test(name.trim())) {
				return () => {
					props.onSelectCategory(item)
				}
			}
		}
	}
	return findFavoriteCategorySelect(props?.children, depth + 1)
}
