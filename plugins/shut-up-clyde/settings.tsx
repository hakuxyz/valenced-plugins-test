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
					Block Clyde error messages and remove common Nitro upsell prompts and
					popups.
				</Text>

				<TableRowGroup title="General">
					<TableSwitchRow
						label="Enable Shut Up Clyde"
						subLabel="Turn all suppression patches on or off."
						value={settings.enabled}
						onValueChange={enabled => update({ enabled })}
					/>
				</TableRowGroup>

				<TableRowGroup title="Clyde">
					<TableSwitchRow
						label="Hide Clyde errors"
						subLabel="Stop Clyde's local error messages before they are shown."
						value={settings.hideClydeErrors}
						disabled={!settings.enabled}
						onValueChange={hideClydeErrors => update({ hideClydeErrors })}
					/>
					<TableSwitchRow
						label="Hide Clyde bot messages"
						subLabel="Filter messages posted by the Clyde bot from the message list."
						value={settings.hideClydeMessages}
						disabled={!settings.enabled}
						onValueChange={hideClydeMessages => update({ hideClydeMessages })}
					/>
				</TableRowGroup>

				<TableRowGroup title="Nitro ads">
					<TableSwitchRow
						label="Hide gift button"
						subLabel="Remove the Nitro gift shortcut from the chat composer."
						value={settings.hideGiftButton}
						disabled={!settings.enabled}
						onValueChange={hideGiftButton => update({ hideGiftButton })}
					/>
					<TableSwitchRow
						label="Hide Nitro upsells"
						subLabel="Remove known Nitro cards, banners, and purchase prompts."
						value={settings.hideNitroPrompts}
						disabled={!settings.enabled}
						onValueChange={hideNitroPrompts => update({ hideNitroPrompts })}
					/>
				</TableRowGroup>

				<Text variant="text-xs/normal" style={{ opacity: 0.6, marginTop: 12 }}>
					Some prompts depend on the Discord version. Reload the affected screen
					if a prompt stays visible.
				</Text>
			</Page>
		</ScrollView>
	)
}
