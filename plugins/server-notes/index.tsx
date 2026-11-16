import { getStore } from '@valenced/discord/flux'
import { instead } from '@valenced/patcher'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import { setStorage } from './state'
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

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start({ cleanup, jsonStorage }) {
		setStorage(jsonStorage!)

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
