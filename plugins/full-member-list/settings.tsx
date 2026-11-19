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
					Show all members in large servers and keep the member list from
					changing while you browse it.
				</Text>

				<TableRowGroup title="Member List">
					<TableSwitchRow
						label="Show all members"
						subLabel="Keep online members normal and progressively load more members while scrolling in servers with more than 1000 members."
						value={settings.showAllMembers}
						onValueChange={showAllMembers => storage.set({ showAllMembers })}
					/>
					<TableSwitchRow
						label="Freeze member list"
						subLabel="Let the member list load, then stop later updates so it does not jump or reorder while you look at it."
						value={settings.freezeMemberList}
						onValueChange={freezeMemberList =>
							storage.set({ freezeMemberList })
						}
					/>
				</TableRowGroup>
			</Page>
		</ScrollView>
	)
}
