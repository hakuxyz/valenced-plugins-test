export function isRecord(value: unknown): value is Record<string, any> {
	return (
		value !== null && (typeof value === 'object' || typeof value === 'function')
	)
}

function isGifPickerClass(value: unknown): boolean {
	if (!isRecord(value) || typeof value !== 'function') return false
	const proto = value.prototype
	return (
		isRecord(proto) &&
		typeof proto.renderHeaderContent === 'function' &&
		typeof proto.render === 'function'
	)
}

export function findGifPickerClasses(value: unknown): Record<string, any>[] {
	const found: Record<string, any>[] = []
	const visited = new WeakSet<object>()

	function visit(current: unknown, depth: number): void {
		if (depth > 4) return
		if (isGifPickerClass(current)) {
			found.push(current as Record<string, any>)
			return
		}
		if (!isRecord(current)) return
		if (visited.has(current)) return
		visited.add(current)

		for (const key of Object.keys(current)) {
			if (key === '_owner' || key === '_store' || key === '_self') continue
			try {
				visit(current[key], depth + 1)
			} catch {}
		}
	}

	visit(value, 0)
	return found
}

export function forceFavorites(instance: any): void {
	const state = instance?.state
	if (isRecord(state) && 'resultType' in state && state.resultType == null) {
		state.resultType = 'Favorites'
	}
}
