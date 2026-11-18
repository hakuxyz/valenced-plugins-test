import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { ScrollView } from 'react-native'
import { DefaultSettings } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

const { TableRadioGroup, TableRadioRow, TableSwitchRow, TableRowGroup, Text } =
	Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const settings = { ...DefaultSettings, ...storage.use() }

	return (
		<ScrollView>
			<Page>
				<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
					Undo and redo for the message box, so a stray edit never loses what
					you already typed.
				</Text>

				<TableRowGroup title="Behavior">
					<TableSwitchRow
						label="Undo and redo buttons"
						subLabel="Show a small pill with undo and redo buttons above the message box."
						value={settings.buttons}
						onValueChange={buttons => storage.set({ buttons })}
					/>
					<TableSwitchRow
						label="Gestures"
						subLabel="Two finger tap over the message box undoes, two finger hold or a double tap redoes."
						value={settings.gestures}
						onValueChange={gestures => storage.set({ gestures })}
					/>
				</TableRowGroup>

				<TableRadioGroup
					title="Button size"
					value={settings.size}
					onChange={size => storage.set({ size })}
				>
					<TableRadioRow label="Small" value="small" />
					<TableRadioRow label="Normal" value="normal" />
					<TableRadioRow label="Large" value="large" />
					<TableRadioRow label="Extra large" value="extraLarge" />
				</TableRadioGroup>

				<TableRadioGroup
					title="Visibility"
					value={settings.pillVisibility}
					onChange={pillVisibility => storage.set({ pillVisibility })}
				>
					<TableRadioRow label="Always" value="always" />
					<TableRadioRow label="Only when available" value="whenAvailable" />
				</TableRadioGroup>
			</Page>
		</ScrollView>
	)
}
