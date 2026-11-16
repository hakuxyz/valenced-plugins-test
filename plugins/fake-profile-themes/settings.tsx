import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import {
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
		if (normalized) storage.set({ [key]: normalized })
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
			text: 'Copied. Paste the invisible text into your bio.',
			variant: 'success',
		})
	}

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
					Pick your colors, copy the hidden text, then paste it anywhere in your
					bio. Other people with this plugin will see the colors on your
					profile.
				</Text>
				<TableRowGroup title="Preview">
					<TableRow
						label="Primary"
						trailing={<Swatch color={primaryColor} />}
					/>
					<TableRow label="Accent" trailing={<Swatch color={accentColor} />} />
				</TableRowGroup>
				<TextInput
					label="Primary color"
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
					label="Accent color"
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
