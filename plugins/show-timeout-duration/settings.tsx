import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { ScrollView } from 'react-native'
import { DefaultSettings } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

const { TableRowGroup, TableSwitchRow, Text } = Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const settings = { ...DefaultSettings, ...storage.use() }

	return (
		<ScrollView>
			<Page>
				<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
					Show how much longer a member's timeout lasts next to their name in
					chat.
				</Text>
				<TableRowGroup title="Display">
					<TableSwitchRow
						label="Show seconds"
						subLabel="Count down every second instead of only showing minutes."
						value={settings.showSeconds}
						onValueChange={value => storage.set({ showSeconds: value })}
					/>
					<TableSwitchRow
						label="Show label"
						subLabel="Add the word left after the duration."
						value={settings.showLabel}
						onValueChange={value => storage.set({ showLabel: value })}
					/>
				</TableRowGroup>
				<Text variant="text-xs/normal" style={{ opacity: 0.6, marginTop: 12 }}>
					The countdown refreshes while timed out messages are visible.
				</Text>
			</Page>
		</ScrollView>
	)
}
