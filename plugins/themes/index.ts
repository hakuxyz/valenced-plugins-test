import { existsSync } from '@valenced/modules/native/fs'
import { pluginStorageDirFor } from '@valenced/plugins/constants'
import SettingsComponent from './settings'
import { DefaultSettings, GroupId, PACKS } from './shared'
import type { Settings } from './shared'

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	preInit({ themes }: any) {
		themes.registerGroup(GroupId, {
			name: 'Packs',
			description: 'Emoji packs, downloaded on demand from settings.',
		})
	},
	async start(api) {
		const { jsonStorage, plugin } = api as any
		const settings = jsonStorage.cache ?? DefaultSettings
		if (!settings.selected) return

		const pack = PACKS.find(p => p.id === settings.selected)
		if (!pack) return

		// Only register a pack whose images have been downloaded to storage.
		const packDir = `${pluginStorageDirFor(plugin.manifest.id)}/packs/${settings.selected}`
		if (!existsSync(packDir)) return

		;(api as any).themes.registerEmojiPack(GroupId, settings.selected, {
			name: pack.name,
			images: packDir,
		})
	},
	SettingsComponent,
})
