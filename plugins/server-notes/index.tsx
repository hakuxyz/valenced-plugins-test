import { getStore } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { after, instead } from '@valenced/patcher'
import { setupColorPicker } from './color-picker'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import { setPendingGuildId, setStorage } from './state'
import type { AnyFunction } from '@valenced/utils/types'
import type { Settings } from './shared'

interface Guild {
	id: string
	name?: string | null
	tagColor?: string | null
	note?: string | null
}

interface GuildStore {
	getGuild(guildId: string): Guild | undefined
}

type Instead = (args: unknown[], original: AnyFunction) => unknown

const insteadLoose = instead as unknown as (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: Instead,
) => () => boolean

function tryPatchGuildMenu(
	cleanup: (...fns: Array<() => unknown>) => void,
	openEditor: (guildId: string) => void,
) {
	try {
		cleanup(
			getModules(
				withName('getGuildsBarGuildMenuItems'),
				(mod: unknown) => {
					const m = mod as Record<string, AnyFunction>
					if (typeof m.default !== 'function') return
					cleanup(
						after(m, 'default', ((result: unknown, ...rest: unknown[]) => {
							const items = result
							const args = (rest[0] as unknown[]) ?? []
							if (!Array.isArray(items)) return items
							const guildId = args?.[0]
							if (typeof guildId !== 'string' || !guildId) return items
							if (items.some((i: any) => i?.serverNotesAction)) return items
							return [
								...items,
								{
									label: 'Server Note',
									serverNotesAction: true,
									action: () => openEditor(guildId),
								},
							]
						}) as unknown as AnyFunction),
					)
				},
				{ returnNamespace: true, max: 1 },
			),
		)
	} catch {
		// Context menu patch is best-effort; settings UI still works.
	}
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start({ cleanup, jsonStorage, ...api }) {
		setStorage(jsonStorage)
		setupColorPicker(cleanup)

		const openEditor = (guildId: string) => {
			setPendingGuildId(guildId)
			try {
				const settingsApi = (api as any).pluginSettings
				if (settingsApi?.openPluginSettings) {
					settingsApi.openPluginSettings('hakuxyz.server-notes')
				}
			} catch {
				// Pending id is stored and will be picked up when settings open.
			}
		}

		tryPatchGuildMenu(cleanup, openEditor)

		cleanup(
			getStore<GuildStore>('GuildStore', store => {
				cleanup(
					insteadLoose(
						store as unknown as Record<string, AnyFunction>,
						'getGuild',
						(args, original) => {
							const guild = original(...args) as Guild | undefined
							if (!guild) return guild

							try {
								const settings = { ...DefaultSettings, ...jsonStorage.cache }
								const note = settings.notes?.[guild.id]
								if (note) {
									guild.tagColor = note.color ?? guild.tagColor
									guild.note = note.note ?? guild.note
								}
							} catch {}

							return guild
						},
					),
				)
			}),
		)
	},
	SettingsComponent,
})
