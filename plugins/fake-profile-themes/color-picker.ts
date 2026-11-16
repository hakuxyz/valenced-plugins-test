import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'

export interface ColorPickerProps {
	color?: number
	onSelect?: (color: unknown) => void
	suggestedColors?: string[]
}

type ShowColorPicker = (props: ColorPickerProps) => void

type Cleanup = (...unpatches: Array<() => boolean | void>) => void

let showColorPicker: ShowColorPicker | undefined

function setColorPicker(module: unknown) {
	const exports = module as {
		showCustomColorPickerActionSheet?: ShowColorPicker
		default?: ShowColorPicker
	}
	const picker =
		typeof module === 'function'
			? (module as ShowColorPicker)
			: (exports?.showCustomColorPickerActionSheet ?? exports?.default)

	if (typeof picker === 'function') showColorPicker = picker
}

export function setupColorPicker(cleanup: Cleanup) {
	cleanup(
		getModules(withProps('showCustomColorPickerActionSheet'), setColorPicker, {
			max: 1,
			returnNamespace: true,
		}),
	)
	cleanup(
		getModules(withName('showCustomColorPickerActionSheet'), setColorPicker, {
			max: 1,
			returnNamespace: true,
		}),
	)
}

export function openColorPicker(props: ColorPickerProps): boolean {
	if (!showColorPicker) return false

	try {
		showColorPicker(props)
		return true
	} catch {
		return false
	}
}
