import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { ScrollView, View } from 'react-native'
import { clampRaise, DefaultSettings, RAISE_LIMIT } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

const {
	TableRadioGroup,
	TableRadioRow,
	TableSwitchRow,
	TableRowGroup,
	Text,
	TextInput,
} = Design

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

				<TableRadioGroup
					title="Button position"
					value={settings.position}
					onChange={position => storage.set({ position })}
				>
					<TableRadioRow label="Right" value="right" />
					<TableRadioRow label="Center" value="center" />
					<TableRadioRow label="Left" value="left" />
				</TableRadioGroup>

				<TableRowGroup title="Height">
					<TextInput
						label="Raise above the message box (px)"
						placeholder="0"
						value={String(settings.raiseBy)}
						onChange={value =>
							storage.set({
								raiseBy: clampRaise(Number(value.replace(/[^0-9]/g, '')) || 0),
							})
						}
					/>
					<View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
						<Text variant="text-xs/normal" style={{ opacity: 0.6 }}>
							0 sits directly above the message box. Higher values move the
							buttons further up, up to {RAISE_LIMIT} px.
						</Text>
					</View>
				</TableRowGroup>
			</Page>
		</ScrollView>
	)
}
