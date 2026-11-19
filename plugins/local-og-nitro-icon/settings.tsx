import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { ScrollView } from 'react-native'
import { DefaultSettings } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { PremiumMode, Settings } from './shared'

const { TableRadioGroup, TableRadioRow, TableRowGroup, TableSwitchRow, Text } =
	Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const settings = { ...DefaultSettings, ...storage.use() }

	const setPremiumMode = (value: string) => {
		if (value === 'original' || value === 'removeEvolved') {
			storage.set({ premiumMode: value as PremiumMode })
		}
	}

	return (
		<ScrollView>
			<Page>
				<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
					Locally replace evolved Nitro badges with the original starter Nitro
					icon, or remove evolved badges for Nitro Premium users.
				</Text>

				<TableRowGroup title="Apply to">
					<TableSwitchRow
						label="Nitro Basic"
						subLabel="Show the original Nitro icon for Nitro Basic users."
						value={settings.applyNitroBasic}
						onValueChange={applyNitroBasic => storage.set({ applyNitroBasic })}
					/>
					<TableSwitchRow
						label="Nitro Premium"
						subLabel="Apply the selected Nitro Premium behavior."
						value={settings.applyNitroPremium}
						onValueChange={applyNitroPremium =>
							storage.set({ applyNitroPremium })
						}
					/>
				</TableRowGroup>

				<TableRadioGroup
					title="Nitro Premium behavior"
					value={settings.premiumMode}
					onChange={setPremiumMode}
					hasIcons={false}
				>
					<TableRadioRow
						label="Force original badge"
						subLabel="Show the original starter Nitro icon instead of the evolved badge."
						value="original"
					/>
					<TableRadioRow
						label="Remove evolved badge"
						subLabel="Hide the Nitro badge for Nitro Premium users after the starter period (1 month)."
						value="removeEvolved"
					/>
				</TableRadioGroup>

				<Text variant="text-xs/normal" style={{ opacity: 0.6, marginTop: 12 }}>
					Changes are local only and depend on the badge/profile data Discord
					provides to the client.
				</Text>
			</Page>
		</ScrollView>
	)
}
