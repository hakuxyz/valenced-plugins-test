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

export function componentName(value: unknown): string {
	if (typeof value === 'function') {
		return value.name || (value as any).displayName || 'anonymous'
	}
	if (isRecord(value)) {
		return String(value.displayName || componentName(value.type))
	}
	return 'unknown'
}

function shortString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	const text = value.trim()
	if (!text || text.length > 120) return undefined
	return text
}

export function inspect(value: unknown, depth = 0): string {
	if (depth > 2) return '...'
	if (typeof value === 'string') return JSON.stringify(value.slice(0, 80))
	if (value === null) return 'null'
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value)
	}
	if (typeof value === 'function') {
		return `fn:${value.name || 'anonymous'}:${String(value).slice(0, 80)}`
	}
	if (Array.isArray(value)) {
		return `[${value.slice(0, 5).map(item => inspect(item, depth + 1))}]`
	}
	if (!isRecord(value)) return typeof value
	let keys: string[]
	try {
		keys = Object.keys(value).slice(0, 8)
	} catch {
		return '?'
	}
	return `{${keys
		.map(key => `${key}:${inspect(value[key], depth + 1)}`)
		.join(',')}}`
}

export function findValuesByKey(
	value: unknown,
	key: string,
	output: unknown[],
	depth = 0,
): void {
	if (depth > 4 || !isRecord(value)) return
	try {
		if (key in value && !output.includes(value[key])) output.push(value[key])
		for (const child of Object.values(value)) {
			findValuesByKey(child, key, output, depth + 1)
		}
	} catch {}
}

export function describeElement(value: unknown): string {
	const parts: string[] = []

	function visit(current: unknown, depth: number): void {
		if (depth > 4 || parts.length >= 8) return
		const text = shortString(current)
		if (text) {
			parts.push(text)
			return
		}
		if (typeof current === 'function') {
			parts.push(`fn:${current.name || 'anonymous'}`)
			return
		}
		if (Array.isArray(current)) {
			for (const item of current) visit(item, depth + 1)
			return
		}
		if (!isRecord(current)) return

		const type = current.type
		if (typeof type === 'string') parts.push(`<${type}>`)
		else if (typeof type === 'function') parts.push(`fn:${type.name}`)

		const props = current.props
		if (isRecord(props)) {
			const label = shortString(props.accessibilityLabel)
			if (label) parts.push(label)
			const keys = Object.keys(props).slice(0, 6)
			if (keys.length) parts.push(`keys:${keys.join(',')}`)
			if ('onSelectCategory' in props && 'item' in props) {
				parts.push(`item:${inspect(props.item)}`)
				parts.push(`select:${inspect(props.onSelectCategory)}`)
			}
			for (const key of ['name', 'title', 'category']) {
				const nested = shortString(props[key])
				if (nested) parts.push(nested)
				else if (isRecord(props[key])) {
					for (const nestedValue of Object.values(props[key])) {
						const nestedText = shortString(nestedValue)
						if (nestedText) {
							parts.push(nestedText)
							break
						}
					}
				}
			}
			visit(props.children, depth + 1)
		}
	}

	visit(value, 0)
	return parts.join(' | ').slice(0, 320) || 'empty'
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
