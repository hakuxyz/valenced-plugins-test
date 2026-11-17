import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { ScrollView } from 'react-native'
import { DefaultSettings } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

const { TableRadioGroup, TableRadioRow, TableSwitchRow, Text } = Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const settings = { ...DefaultSettings, ...storage.use() }

	return (
		<ScrollView>
			<Page>
				<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
					A little cat that follows your touches around the app, like the Oneko
					plugin for desktop.
				</Text>

				<TableSwitchRow
					label="Show cat"
					value={settings.enabled}
					onValueChange={enabled => storage.set({ enabled })}
				/>

				<TableRadioGroup
					title="Size"
					value={settings.size}
					onChange={size => storage.set({ size })}
				>
					<TableRadioRow label="Small" value="small" />
					<TableRadioRow label="Medium" value="medium" />
					<TableRadioRow label="Large" value="large" />
				</TableRadioGroup>

				<TableRadioGroup
					title="Speed"
					value={settings.speed}
					onChange={speed => storage.set({ speed })}
				>
					<TableRadioRow label="Slow" value="slow" />
					<TableRadioRow label="Normal" value="normal" />
					<TableRadioRow label="Fast" value="fast" />
				</TableRadioGroup>

				<TableSwitchRow
					label="Sleep when idle"
					subLabel="The cat walks home and curls up after 20 seconds without touching the screen."
					value={settings.sleep}
					onValueChange={sleep => storage.set({ sleep })}
				/>
			</Page>
		</ScrollView>
	)
}
