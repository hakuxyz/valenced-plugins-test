import { getModules, lookupModule } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'

export interface ColorPickerProps {
	color?: number
	onSelect?: (color: unknown) => void
	suggestedColors?: string[]
}

type ShowColorPicker = (props: ColorPickerProps) => void

type Cleanup = (...unpatches: Array<() => boolean | void>) => void

let showColorPicker: ShowColorPicker | undefined

function pickFunction(module: unknown): ShowColorPicker | undefined {
	if (typeof module === 'function') return module as ShowColorPicker
	if (typeof module !== 'object' || module === null) return undefined
	const m = module as Record<string, unknown>
	if (typeof m.showCustomColorPickerActionSheet === 'function') {
		return m.showCustomColorPickerActionSheet as ShowColorPicker
	}
	if (typeof m.default === 'function') return m.default as ShowColorPicker
	return undefined
}

function setColorPicker(module: unknown) {
	const picker = pickFunction(module)
	if (picker) showColorPicker = picker
}

function tryLookupNow() {
	if (showColorPicker) return
	const lookup = lookupModule as unknown as (filter: unknown) => unknown
	try {
		const res1 = lookup(withProps('showCustomColorPickerActionSheet'))
		if (Array.isArray(res1)) setColorPicker(res1[0])
	} catch {}
	if (showColorPicker) return
	try {
		const res2 = lookup(withName('showCustomColorPickerActionSheet'))
		if (Array.isArray(res2)) setColorPicker(res2[0])
	} catch {}
}

export function setupColorPicker(cleanup: Cleanup) {
	// Keep watching for lazy initialization
	cleanup(
		getModules(withProps('showCustomColorPickerActionSheet'), setColorPicker, {
			returnNamespace: true,
		}),
	)
	cleanup(
		getModules(withName('showCustomColorPickerActionSheet'), setColorPicker, {
			returnNamespace: true,
		}),
	)
	// Try immediate lookup in case it's already available
	tryLookupNow()
}

export function openColorPicker(props: ColorPickerProps): boolean {
	if (!showColorPicker) tryLookupNow()
	if (!showColorPicker) return false

	try {
		showColorPicker(props)
		return true
	} catch {
		showColorPicker = undefined
		tryLookupNow()
		if (!showColorPicker) return false
		try {
			showColorPicker(props)
			return true
		} catch {
			return false
		}
	}
}
