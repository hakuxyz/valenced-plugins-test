export function isRecord(value: unknown): value is Record<string, any> {
	return (
		value !== null && (typeof value === 'object' || typeof value === 'function')
	)
}

export function matchesName(value: unknown, name: string): boolean {
	try {
		if (typeof value === 'function') {
			return value.name === name || (value as any).displayName === name
		}
		if (!isRecord(value)) return false
		return (
			value.displayName === name ||
			(value.type ? matchesName(value.type, name) : false)
		)
	} catch {
		return false
	}
}

export function findNamed(
	value: unknown,
	names: string[],
	output: unknown[],
	depth = 0,
): void {
	if (depth > 4) return
	if (names.some(name => matchesName(value, name))) {
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
			findNamed(value[key], names, output, depth + 1)
		} catch {}
	}
}

const FAVORITES_LABEL = /(^|\W)favorites(\W|$)/i

function hasFavoriteLabel(value: unknown, depth = 0): boolean {
	if (depth > 4) return false
	if (typeof value === 'string') return FAVORITES_LABEL.test(value)
	if (typeof value === 'function') return false
	if (Array.isArray(value)) {
		return value.some(item => hasFavoriteLabel(item, depth + 1))
	}
	if (!isRecord(value)) return false
	return Object.values(value).some(item => hasFavoriteLabel(item, depth + 1))
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
		if (typeof onPress === 'function' && hasFavoriteLabel(props)) {
			return () => {
				onPress()
			}
		}
		const found = findFavoritePress(props.children, depth + 1)
		if (found) return found
	}
	return undefined
}
