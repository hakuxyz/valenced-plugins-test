import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { ScrollView, View } from 'react-native'
import { COMMANDS } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'

const { TableRowGroup, Text } = Design

type Props = ComponentProps<PluginSettingsComponent>

export default function SettingsComponent(_props: Props) {
	return (
		<ScrollView>
			<Page>
				<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
					Type one of these commands in any channel. The result is copied
					straight to your clipboard.
				</Text>

				<TableRowGroup title="Commands">
					{COMMANDS.map(item => (
						<View
							key={item.command}
							style={{ paddingHorizontal: 16, paddingVertical: 10 }}
						>
							<Text variant="text-md/semibold">{item.command}</Text>
							<Text
								variant="text-sm/normal"
								style={{ opacity: 0.7, marginTop: 2 }}
							>
								{item.description}
							</Text>
						</View>
					))}
				</TableRowGroup>

				<Text variant="text-xs/normal" style={{ opacity: 0.6, marginTop: 12 }}>
					Leave the user option empty to use your own account. User ids and
					mentions are both accepted.
				</Text>
			</Page>
		</ScrollView>
	)
}
