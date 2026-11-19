import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { ScrollView } from 'react-native'
import { mergeSettings } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

const { TableRadioGroup, TableRadioRow, TableRowGroup, TableSwitchRow, Text } =
	Design

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
					Keep low-resolution image uploads sharp by rendering them like pasted
					image links and loading the original attachment URL.
				</Text>

				<TableRowGroup title="General">
					<TableSwitchRow
						label="Enable Image Fixer"
						subLabel="Turn both image fixes on or off."
						value={settings.enabled}
						onValueChange={enabled => update({ enabled })}
					/>
				</TableRowGroup>

				<TableRowGroup title="Matching">
					<TableRadioGroup
						title="Apply to"
						value={settings.imageScope}
						onChange={imageScope => update({ imageScope })}
					>
						<TableRadioRow label="Small images only" value="small" />
						<TableRadioRow label="All image attachments" value="all" />
					</TableRadioGroup>

					{settings.imageScope === 'small' && (
						<TableRadioGroup
							title="Small image limit"
							value={settings.smallImageLimit}
							onChange={smallImageLimit => update({ smallImageLimit })}
						>
							<TableRadioRow label="128 px" value={128} />
							<TableRadioRow label="256 px" value={256} />
							<TableRadioRow label="512 px" value={512} />
						</TableRadioGroup>
					)}
				</TableRowGroup>

				<TableRowGroup title="Fixes">
					<TableSwitchRow
						label="Render as image links"
						subLabel="Show a single matching image attachment through Discord's image link renderer."
						value={settings.renderAsLinks}
						disabled={!settings.enabled}
						onValueChange={renderAsLinks => update({ renderAsLinks })}
					/>
					<TableSwitchRow
						label="Use original attachment URLs"
						subLabel="Remove resize parameters and load the original Discord CDN image."
						value={settings.useOriginalUrls}
						disabled={!settings.enabled}
						onValueChange={useOriginalUrls => update({ useOriginalUrls })}
					/>
				</TableRowGroup>

				<Text variant="text-xs/normal" style={{ opacity: 0.6, marginTop: 12 }}>
					Changes apply to newly rendered messages. Reload the channel if an old
					image keeps its previous appearance.
				</Text>
			</Page>
		</ScrollView>
	)
}
