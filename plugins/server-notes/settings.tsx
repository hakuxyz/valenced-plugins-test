import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { ScrollView } from 'react-native'
import { DefaultSettings } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

const { Button, TableRow, TableRowGroup, Text } = Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const settings = { ...DefaultSettings, ...storage.use() }

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
					Add notes to servers so you remember why you joined - or why you left.
				</Text>
				<TableRowGroup title="Server Notes">
					{Object.entries(settings.notes ?? {}).map(([guildId, note]) => (
						<TableRow
							key={guildId}
							label={note.note || guildId}
							subLabel={`Color: ${note.color ?? 'default'}`}
							onPress={() => {}}
						/>
					))}
				</TableRowGroup>
			</Page>
		</ScrollView>
	)
}
