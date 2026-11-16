import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { after, before } from '@valenced/patcher'
import { React, ReactJSXRuntime } from '@valenced/react'
import { useState } from 'react'
import { View } from 'react-native'
import { refreshProfilePreview } from './refresh'
import {
	colorValueToNumber,
	encodeColors,
	hexToNumber,
	withColorCode,
} from './shared'
import { currentSettings, storage } from './state'
import type { AnyFunction } from '@valenced/utils/types'

const { TableRow, TableRowGroup } = Design

const EditFormComponents = new Set([
	'EditUserProfileBio',
	'EditGuildIdentityBio',
])

const BioValueKeys = [
	'value',
	'bio',
	'bioText',
	'text',
	'description',
	'aboutMe',
	'draft',
]

const BioSetterKeys = [
	'onChangeText',
	'onBioChange',
	'onChangeBio',
	'onValueChange',
	'onChange',
	'setValue',
	'setBio',
	'updateBio',
]

type Cleanup = (...unpatches: Array<() => boolean | void>) => void

interface ColorPickerProps {
	color?: number
	onSelect?: (color: unknown) => void
	suggestedColors?: string[]
}

type ShowColorPicker = (props: ColorPickerProps) => void

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

interface BioHandle {
	get(): string
	set(value: string): void
}

let activeBio: BioHandle | undefined

function findBioHandle(props: ElementProps | undefined): BioHandle | null {
	if (!props) return null

	let setter: ((value: string) => void) | undefined
	for (const key of BioSetterKeys) {
		const value = props[key]
		if (typeof value === 'function') {
			setter = value as (value: string) => void
			break
		}
	}
	if (!setter) return null

	for (const key of BioValueKeys) {
		if (typeof props[key] !== 'string') continue

		return {
			// Read from the props object directly so text the user typed after the
			// last render is not lost when a color is picked.
			get: () => {
				const current = props[key]
				return typeof current === 'string' ? current : ''
			},
			set: value => {
				try {
					setter?.(value)
				} catch {}
			},
		}
	}

	return null
}

function autoBioEnabled() {
	return currentSettings().autoBio
}

function writeColorsToBio(primary: string, accent: string): boolean {
	const primaryColor = hexToNumber(primary)
	const accentColor = hexToNumber(accent)
	if (primaryColor == null || accentColor == null) return false

	const handle = activeBio
	if (!handle) return false

	try {
		const next = withColorCode(handle.get(), primaryColor, accentColor)
		if (next == null) return false

		handle.set(next)
		return true
	} catch {
		return false
	}
}

function Swatch({ color }: { color: string }) {
	return (
		<View
			style={{
				backgroundColor: color,
				borderRadius: 6,
				height: 28,
				width: 28,
			}}
		/>
	)
}

interface BuilderProps {
	allowBio?: boolean
}

export default function Builder({ allowBio = false }: BuilderProps) {
	const settings = currentSettings()
	const [primary, setPrimary] = useState(settings.primary)
	const [accent, setAccent] = useState(settings.accent)

	const pick = (key: 'primary' | 'accent') => {
		if (!showColorPicker) {
			ToastActionCreators.open('FAKE_PROFILE_THEMES_PICKER', {
				text: 'Color picker not available. Enter hex colors in the plugin settings.',
				variant: 'critical',
			})
			return
		}

		const color = hexToNumber(key === 'primary' ? primary : accent)
		showColorPicker({
			color: color ?? undefined,
			onSelect: value => {
				const picked = colorValueToNumber(value)
				if (picked == null) return

				const hex = `#${picked.toString(16).padStart(6, '0')}`
				const nextPrimary = key === 'primary' ? hex : primary
				const nextAccent = key === 'accent' ? hex : accent

				if (key === 'primary') setPrimary(hex)
				else setAccent(hex)
				storage?.set({ [key]: hex })

				if (allowBio && autoBioEnabled()) {
					writeColorsToBio(nextPrimary, nextAccent)
				}
				refreshProfilePreview()
			},
		})
	}

	const writeBio = () => {
		if (writeColorsToBio(primary, accent)) {
			ToastActionCreators.open('FAKE_PROFILE_THEMES_BIO_WRITTEN', {
				text: 'Hidden colors written into your bio. Old color codes were removed.',
				variant: 'success',
			})
		} else {
			ToastActionCreators.open('FAKE_PROFILE_THEMES_BIO_FAILED', {
				text: 'Could not write into the bio field. Use Copy 3y3 instead.',
				variant: 'critical',
			})
		}
	}

	const copy = () => {
		const primaryColor = hexToNumber(primary)
		const accentColor = hexToNumber(accent)

		if (primaryColor == null || accentColor == null) {
			ToastActionCreators.open('FAKE_PROFILE_THEMES_INVALID', {
				text: 'Pick both colors first.',
				variant: 'critical',
			})
			return
		}

		Clipboard.setString(encodeColors(primaryColor, accentColor))
		ToastActionCreators.open('FAKE_PROFILE_THEMES_COPIED', {
			text: 'Copied. Paste the invisible text into your bio.',
			variant: 'success',
		})
	}

	return (
		<TableRowGroup
			title="Fake Profile Themes"
			description="Tap a color to open the color picker."
		>
			<TableRow
				icon={<Swatch color={primary} />}
				label="Primary color"
				subLabel={primary.toUpperCase()}
				onPress={() => pick('primary')}
				arrow
			/>
			<TableRow
				icon={<Swatch color={accent} />}
				label="Accent color"
				subLabel={accent.toUpperCase()}
				onPress={() => pick('accent')}
				arrow
			/>
			{allowBio && activeBio != null && (
				<TableRow
					icon={<TableRowAssetIcon name="PencilIcon" />}
					label="Write colors into bio"
					subLabel="Replaces older hidden color codes."
					onPress={writeBio}
				/>
			)}
			<TableRow
				icon={<TableRowAssetIcon name="CopyIcon" />}
				label="Copy 3y3 text"
				subLabel="Paste it anywhere in your bio."
				onPress={copy}
			/>
		</TableRowGroup>
	)
}

type ElementProps = Record<string, unknown> & { children?: unknown }
type Element = { type: unknown; props: ElementProps }
type JSXArgs = [unknown, ElementProps | undefined, ...unknown[]]

function isElement(value: unknown): value is Element {
	return (
		typeof value === 'object' &&
		value !== null &&
		'type' in value &&
		'props' in value
	)
}

function getComponentNameFromType(type: unknown): string | null {
	if (typeof type === 'string') return type
	if (typeof type === 'function') {
		const fn = type as { displayName?: string; name?: string }
		return fn.displayName ?? fn.name ?? null
	}
	if (typeof type !== 'object' || type === null) return null

	const record = type as {
		displayName?: string
		render?: { displayName?: string; name?: string }
		type?: unknown
	}
	return (
		record.displayName ??
		record.render?.displayName ??
		record.render?.name ??
		getComponentNameFromType(record.type)
	)
}

function isEditFormElement(value: unknown) {
	if (!isElement(value)) return false

	const name = getComponentNameFromType(value.type)
	return name != null && EditFormComponents.has(name)
}

function findParentWithEditForm(node: unknown, depth = 200): Element | null {
	if (depth <= 0 || !isElement(node)) return null

	const children = node.props.children
	if (Array.isArray(children) && children.some(isEditFormElement)) {
		return node
	}

	if (Array.isArray(children)) {
		for (const child of children) {
			const found = findParentWithEditForm(child, depth - 1)
			if (found) return found
		}
	} else if (isElement(children)) {
		return findParentWithEditForm(children, depth - 1)
	}

	return null
}

function updateBioHandle(element: Element) {
	const name = getComponentNameFromType(element.type)
	if (name !== 'EditUserProfileBio') return

	const handle = findBioHandle(element.props)
	if (handle) activeBio = handle
}

function injectIntoChildren(children: unknown[], allowBio = false): boolean {
	if (children.some(child => isElement(child) && child.type === Builder)) {
		return false
	}

	const index = children.findIndex(isEditFormElement)
	if (index < 0) return false

	const editForm = children[index] as Element
	updateBioHandle(editForm)

	children.splice(index + 1, 0, ReactJSXRuntime.jsx(Builder, { allowBio }))
	return true
}

function injectIntoTree(tree: unknown): unknown {
	const parent = findParentWithEditForm(tree)
	if (!parent) return tree

	const children = parent.props.children
	if (!Array.isArray(children)) return tree

	const editForm = children.find(isEditFormElement) as Element | undefined
	const allowBio =
		editForm != null &&
		getComponentNameFromType(editForm.type) === 'EditUserProfileBio'

	try {
		injectIntoChildren(children, allowBio)
	} catch {}

	return tree
}

function injectBuilder(args: JSXArgs): JSXArgs {
	const props = args[1]
	const children = props?.children
	if (!props || !Array.isArray(children)) return args

	const editForm = children.find(isEditFormElement) as Element | undefined
	const allowBio =
		editForm != null &&
		getComponentNameFromType(editForm.type) === 'EditUserProfileBio'

	try {
		injectIntoChildren(children, allowBio)
	} catch {}

	args[1] = { ...props, children }
	return args
}

export function setupBuilder(cleanup: Cleanup) {
	for (const name of ['UserProfileEditForm', 'GuildProfileEditForm']) {
		cleanup(
			getModules(
				withName(name),
				module => {
					try {
						const record = module as {
							default?: AnyFunction
						}
						if (typeof record?.default !== 'function') return

						cleanup(
							after(record as Record<'default', AnyFunction>, 'default', tree =>
								injectIntoTree(tree),
							),
						)
					} catch {}
				},
				{ max: 1, returnNamespace: true },
			),
		)
	}

	const hook = injectBuilder as AnyFunction

	cleanup(
		before(
			ReactJSXRuntime as unknown as Record<'jsx', AnyFunction>,
			'jsx',
			hook,
		),
		before(
			ReactJSXRuntime as unknown as Record<'jsxs', AnyFunction>,
			'jsxs',
			hook,
		),
		before(
			React as unknown as Record<'createElement', AnyFunction>,
			'createElement',
			hook,
		),
	)
}
