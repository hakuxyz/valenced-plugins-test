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
					Hide users you have blocked or ignored from server and group DM member
					lists. Other people still see them normally.
				</Text>

				<TableRowGroup title="Hide from member lists">
					<TableSwitchRow
						label="Blocked users"
						subLabel="Remove users you have blocked from member lists."
						value={settings.blocked}
						onValueChange={(value: boolean) => storage.set({ blocked: value })}
					/>
					<TableSwitchRow
						label="Ignored users"
						subLabel="Also remove users you have ignored from member lists."
						value={settings.ignored}
						onValueChange={(value: boolean) => storage.set({ ignored: value })}
					/>
				</TableRowGroup>
			</Page>
		</ScrollView>
	)
}
