import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { before } from '@valenced/patcher'
import { React, ReactJSXRuntime } from '@valenced/react'
import { useState } from 'react'
import { View } from 'react-native'
import { DefaultSettings, encodeColors, hexToNumber } from './shared'
import { storage } from './state'
import type { AnyFunction } from '@valenced/utils/types'

const { TableRow, TableRowGroup } = Design

const EditFormComponents = new Set([
	'EditUserProfileBio',
	'EditGuildIdentityBio',
])

type Cleanup = (...unpatches: Array<() => boolean | void>) => void

interface ColorPickerProps {
	color?: number
	onSelect?: (color: number) => void
	suggestedColors?: string[]
}

type ShowColorPicker = (props: ColorPickerProps) => void

let showColorPicker: ShowColorPicker | undefined

function setColorPicker(module: unknown) {
	const exports = module as {
		showCustomColorPickerActionSheet?: ShowColorPicker
		default?: ShowColorPicker
	}
	const picker = exports?.showCustomColorPickerActionSheet ?? exports?.default

	if (typeof picker === 'function') showColorPicker = picker
}

export function setupColorPicker(cleanup: Cleanup) {
	cleanup(
		getModules(withProps('showCustomColorPickerActionSheet'), setColorPicker, {
			max: 1,
		}),
	)
	cleanup(
		getModules(withName('showCustomColorPickerActionSheet'), setColorPicker, {
			max: 1,
		}),
	)
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

export default function Builder() {
	const settings = { ...DefaultSettings, ...(storage?.cache ?? {}) }
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
				const hex = `#${value.toString(16).padStart(6, '0')}`
				if (key === 'primary') setPrimary(hex)
				else setAccent(hex)
				storage?.set({ [key]: hex })
			},
		})
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
type JSXArgs = [unknown, ElementProps | undefined, ...unknown[]]

function isEditFormElement(value: unknown) {
	if (typeof value !== 'object' || value === null) return false

	const type = (value as { type?: unknown }).type
	return typeof type === 'function' && EditFormComponents.has(type.name)
}

function injectBuilder(args: JSXArgs): JSXArgs {
	const props = args[1]
	const children = props?.children
	if (!props || !Array.isArray(children)) return args

	const index = children.findIndex(isEditFormElement)
	if (index < 0) return args

	args[1] = {
		...props,
		children: [
			...children.slice(0, index + 1),
			ReactJSXRuntime.jsx(Builder, {}),
			...children.slice(index + 1),
		],
	}

	return args
}

export function setupBuilder(cleanup: Cleanup) {
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
