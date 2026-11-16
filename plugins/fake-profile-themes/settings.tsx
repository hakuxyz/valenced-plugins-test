import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { openColorPicker } from './color-picker'
import { refreshProfilePreview } from './refresh'
import {
	colorValueToNumber,
	DefaultSettings,
	encodeColors,
	hexToNumber,
	normalizeHex,
} from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

const { Button, TableRow, TableRowGroup, TableSwitchRow, Text, TextInput } =
	Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

function Swatch({ color }: { color: number | null }) {
	return (
		<View
			style={{
				backgroundColor:
					color == null ? '#4e5058' : `#${color.toString(16).padStart(6, '0')}`,
				borderRadius: 6,
				height: 28,
				width: 28,
			}}
		/>
	)
}

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const settings = { ...DefaultSettings, ...storage.use() }
	const [primary, setPrimary] = useState(settings.primary)
	const [accent, setAccent] = useState(settings.accent)

	const primaryColor = hexToNumber(primary)
	const accentColor = hexToNumber(accent)

	const update = (key: 'primary' | 'accent', value: string) => {
		if (key === 'primary') setPrimary(value)
		else setAccent(value)

		const normalized = normalizeHex(value)
		if (normalized && normalized !== settings[key]) {
			storage.set({ [key]: normalized })
			refreshProfilePreview()
		}
	}

	const pick = (key: 'primary' | 'accent') => {
		const current = hexToNumber(key === 'primary' ? primary : accent)
		const opened = openColorPicker({
			color: current ?? undefined,
			onSelect: value => {
				const picked = colorValueToNumber(value)
				if (picked == null) return

				const hex = `#${picked.toString(16).padStart(6, '0')}`
				update(key, hex)
			},
		})

		if (!opened) {
			ToastActionCreators.open('FAKE_PROFILE_THEMES_PICKER', {
				text: 'Color picker not available. Enter the hex value below instead.',
				variant: 'critical',
			})
		}
	}

	const copy = () => {
		if (primaryColor == null || accentColor == null) {
			ToastActionCreators.open('FAKE_PROFILE_THEMES_INVALID', {
				text: 'Enter both colors as six digit hex values.',
				variant: 'critical',
			})
			return
		}

		Clipboard.setString(encodeColors(primaryColor, accentColor))
		ToastActionCreators.open('FAKE_PROFILE_THEMES_COPIED', {
			text: 'Copied. Paste the invisible text anywhere into your bio.',
			variant: 'success',
		})
	}

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
					Pick your colors, then copy the hidden 3y3 text and paste it anywhere
					into your bio. Other people with this plugin will see the colors on
					your profile.
				</Text>
				<TableRowGroup title="Colors">
					<TableRow
						icon={<Swatch color={primaryColor} />}
						label="Primary color"
						subLabel={primary.toUpperCase()}
						onPress={() => pick('primary')}
						arrow
					/>
					<TableRow
						icon={<Swatch color={accentColor} />}
						label="Accent color"
						subLabel={accent.toUpperCase()}
						onPress={() => pick('accent')}
						arrow
					/>
				</TableRowGroup>
				<TextInput
					label="Primary hex"
					placeholder="#5865f2"
					value={primary}
					status={primaryColor == null ? 'error' : 'default'}
					errorMessage={
						primaryColor == null
							? 'Use six hex digits, like #5865f2.'
							: undefined
					}
					onChange={value => update('primary', value)}
				/>
				<TextInput
					label="Accent hex"
					placeholder="#eb459e"
					value={accent}
					status={accentColor == null ? 'error' : 'default'}
					errorMessage={
						accentColor == null
							? 'Use six hex digits, like #eb459e.'
							: undefined
					}
					onChange={value => update('accent', value)}
				/>
				<Button
					text="Copy 3y3"
					variant="secondary"
					disabled={primaryColor == null || accentColor == null}
					onPress={copy}
				/>
				<TableRowGroup title="Behavior">
					<TableSwitchRow
						icon={<TableRowAssetIcon name="NitroWheelIcon" />}
						label="Prefer Nitro colors"
						subLabel="Keep real profile colors if a profile has both Nitro and hidden colors."
						value={settings.nitroFirst}
						onValueChange={nitroFirst => storage.set({ nitroFirst })}
					/>
				</TableRowGroup>
			</Page>
		</ScrollView>
	)
}
