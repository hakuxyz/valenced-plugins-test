import { getStore } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { after, instead } from '@valenced/patcher'
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

function addMenuItem(
	items: unknown,
	guildId: unknown,
	openEditor: (guildId: string) => void,
	label = 'Server Note',
	marker = 'serverNotesAction',
) {
	if (!Array.isArray(items)) return items
	if (typeof guildId !== 'string' || !guildId) return items
	if (items.some((i: any) => i?.[marker])) return items
	return [
		...items,
		{
			label,
			[marker]: true,
			action: () => openEditor(guildId),
		},
	]
}

function tryPatchGuildMenu(
	cleanup: (...fns: Array<() => unknown>) => void,
	openEditor: (guildId: string) => void,
) {
	const tryName = (name: string, marker: string) => {
		try {
			cleanup(
				getModules(
					withName(name),
					(mod: unknown) => {
						const m = mod as Record<string, AnyFunction>
						if (typeof m.default !== 'function') return
						cleanup(
							after(m, 'default', ((result: unknown, ...rest: unknown[]) => {
								const args = (rest[0] as unknown[]) ?? []
								const guildId =
									args?.[0] ??
									(args?.[0] as any)?.guildId ??
									(args?.[0] as any)?.guild?.id
								return addMenuItem(
									result,
									guildId,
									openEditor,
									'Server Note',
									marker,
								)
							}) as unknown as AnyFunction),
						)
					},
					{ returnNamespace: true },
				),
			)
		} catch {}
	}

	tryName('getGuildsBarGuildMenuItems', 'serverNotesAction')
	tryName('getGuildFolderMenuItems', 'serverNotesFolderAction')
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start({ cleanup, jsonStorage, ...api }) {
		setStorage(jsonStorage)

		const openEditor = (guildId: string) => {
			setPendingGuildId(guildId)
			try {
				const settingsApi = (api as any).pluginSettings
				if (settingsApi?.openPluginSettings) {
					settingsApi.openPluginSettings('hakuxyz.server-notes')
					return
				}
			} catch {}
			// Pending id is stored; user can open plugin settings to edit.
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
									;(guild as any).serverNote = note.note
									;(guild as any).serverNoteColor = note.color
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
