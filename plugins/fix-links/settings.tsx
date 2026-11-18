import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { ScrollView, View } from 'react-native'
import { mergeSettings, normalizeReplacement, PLATFORMS } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { PlatformKey, PlatformSetting, Settings } from './shared'

const { TableRowGroup, TableSwitchRow, Text, TextInput } = Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const settings = mergeSettings(storage.use())

	const update = (patch: Partial<Settings>) => {
		storage.set(patch)
	}

	const updatePlatform = (
		key: PlatformKey,
		patch: Partial<PlatformSetting>,
	) => {
		const current = mergeSettings(storage.cache)
		storage.set({
			platforms: {
				...current.platforms,
				[key]: { ...current.platforms[key], ...patch },
			},
		})
	}

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Text variant="text-md/normal" style={{ marginBottom: 12 }}>
					Rewrite social media links before you send or edit a message. Each
					platform has its own switch and its own replacement link.
				</Text>

				<TableRowGroup title="General">
					<TableSwitchRow
						label="Enable FixLinks"
						subLabel="Rewrite links when messages are sent."
						value={settings.enabled}
						onValueChange={enabled => update({ enabled })}
					/>
					<TableSwitchRow
						label="Rewrite edited messages"
						subLabel="Apply the same rules when a message is edited."
						value={settings.rewriteEdits}
						disabled={!settings.enabled}
						onValueChange={rewriteEdits => update({ rewriteEdits })}
					/>
				</TableRowGroup>

				{PLATFORMS.map(platform => {
					const current = settings.platforms[platform.key]
					const raw = current.domain.trim()
					const invalid =
						raw.length > 0 &&
						normalizeReplacement(raw, platform.defaultDomain) === undefined

					return (
						<TableRowGroup title={platform.label} key={platform.key}>
							<TableSwitchRow
								label={`Fix ${platform.label}`}
								subLabel={platform.source}
								value={current.enabled}
								disabled={!settings.enabled}
								onValueChange={enabled =>
									updatePlatform(platform.key, { enabled })
								}
							/>
							<TextInput
								label="Replacement link"
								placeholder={platform.defaultDomain}
								value={current.domain}
								status={invalid ? 'error' : 'default'}
								errorMessage={
									invalid
										? 'Use a domain like fxtwitter.com or a full URL.'
										: undefined
								}
								onChange={domain => updatePlatform(platform.key, { domain })}
							/>
							<View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
								<Text variant="text-xs/normal" style={{ opacity: 0.6 }}>
									Default: {platform.defaultDomain}. Leave empty to use the
									default. You can also enter your own instance URL, for example
									https://fx.example.com/prefix.
								</Text>
							</View>
						</TableRowGroup>
					)
				})}
			</Page>
		</ScrollView>
	)
}
