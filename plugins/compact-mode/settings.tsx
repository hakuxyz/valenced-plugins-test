import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { ScrollView } from 'react-native'
import { mergeSettings } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

const { TableRowGroup, TableSwitchRow, Text } = Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const settings = mergeSettings(storage.use())
	const update = (patch: Partial<Settings>) => storage.set(patch)

	return (
		<ScrollView>
			<Page>
				<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
					Remove the large message header and show the username inline with the
					message content.
				</Text>

				<TableRowGroup title="General">
					<TableSwitchRow
						label="Enable Compact Mode"
						subLabel="Use compact message rows in every channel."
						value={settings.enabled}
						onValueChange={enabled => update({ enabled })}
					/>
				</TableRowGroup>

				<TableRowGroup title="Header">
					<TableSwitchRow
						label="No Inline Header"
						subLabel="Put the username on its own line above the message."
						value={settings.noInline}
						disabled={!settings.enabled}
						onValueChange={noInline => update({ noInline })}
					/>
					<TableSwitchRow
						label="Show Avatars"
						subLabel="Show the author avatar before the inline username."
						value={settings.avatars}
						disabled={!settings.enabled}
						onValueChange={avatars => update({ avatars })}
					/>
					<TableSwitchRow
						label="Full Inline Timestamps"
						subLabel="Show the full inline time instead of a shortened one."
						value={settings.inlineTimestamps}
						disabled={!settings.enabled}
						onValueChange={inlineTimestamps => update({ inlineTimestamps })}
					/>
					<TableSwitchRow
						label="Bigger Username Header"
						subLabel="Render the inline header as a larger heading."
						value={settings.biggerHeader}
						disabled={!settings.enabled}
						onValueChange={biggerHeader => update({ biggerHeader })}
					/>
				</TableRowGroup>

				<TableRowGroup title="Replies">
					<TableSwitchRow
						label="Hide Reply Avatars"
						subLabel="Remove the avatar from the replied-to message preview."
						value={settings.noReplyAvatars}
						disabled={!settings.enabled}
						onValueChange={noReplyAvatars => update({ noReplyAvatars })}
					/>
				</TableRowGroup>

				<Text variant="text-xs/normal" style={{ opacity: 0.6, marginTop: 12 }}>
					Changes apply to newly rendered messages. Reload the channel if old
					messages keep their previous layout.
				</Text>
			</Page>
		</ScrollView>
	)
}
