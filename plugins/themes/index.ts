import { pluginStorageDirFor } from '@valenced/plugins/constants'
import { readEmojiSelection, writeEmojiSelection } from './native'
import SettingsComponent from './settings'
import { DefaultSettings, GroupId, PACKS } from './shared'
import type { Settings } from './shared'

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start(api) {
		const { jsonStorage, plugin } = api
		try {
			const themes = (api as any).themes
			if (!themes) return

			themes.registerGroup(GroupId, {
				name: 'Packs',
				description: 'Emoji packs, downloaded on demand from settings.',
			})

			const settings = { ...DefaultSettings, ...jsonStorage.cache }
			const pack = PACKS.find(p => p.id === settings.selected)
			// Only packs recorded as downloaded have images in storage, so the
			// selection survives a reload without re-downloading.
			if (!pack || !settings.downloaded.includes(pack.id)) return

			const images = `${pluginStorageDirFor(plugin.manifest.id)}/packs/${pack.id}`
			themes.registerEmojiPack(GroupId, pack.id, {
				name: pack.name,
				images,
			})

			// Older installs saved a pack without writing the native selection.
			// Never take over a pack chosen in another themes provider.
			const current = readEmojiSelection()
			if (!current || current.plugin === plugin.manifest.id)
				void writeEmojiSelection({
					plugin: plugin.manifest.id,
					group: GroupId,
					pack: pack.id,
					images,
				}).catch(e => plugin.reportError(e))
		} catch (e) {
			// reportError only logs, so a bad pack can never disable the plugin.
			plugin.reportError(e)
		}
	},
	SettingsComponent,
})
