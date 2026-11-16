import { getStore, Stores } from '@valenced/discord/flux'
import { after } from '@valenced/patcher'
import { setupBuilder, setupColorPicker } from './builder'
import SettingsComponent from './settings'
import { DefaultSettings, decodeColors, hexToNumber } from './shared'
import { setStorage } from './state'
import type { Settings } from './shared'

interface UserProfile {
	id?: string
	userId?: string
	bio?: string | null
	themeColors?: number[] | null
	premiumType?: number
	profileFetchFailed?: boolean
}

interface UserProfileStore {
	getUserProfile(userId: string): UserProfile | undefined
}

interface UserStore {
	getCurrentUser(): { id: string } | undefined
}

function colorsFromSettings(
	settings: Partial<Settings>,
): [number, number] | null {
	const primary = hexToNumber(settings.primary ?? DefaultSettings.primary)
	const accent = hexToNumber(settings.accent ?? DefaultSettings.accent)

	return primary == null || accent == null ? null : [primary, accent]
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start({ cleanup, jsonStorage }) {
		setStorage(jsonStorage)
		setupColorPicker(cleanup)
		setupBuilder(cleanup)

		cleanup(
			getStore<UserProfileStore>('UserProfileStore', store => {
				cleanup(
					after(store, 'getUserProfile', (profile: UserProfile | undefined) => {
						if (!profile || profile.profileFetchFailed) return profile

						try {
							const settings = { ...DefaultSettings, ...jsonStorage.cache }
							if (settings.nitroFirst && profile.themeColors != null) {
								return profile
							}

							const userStore = Stores.UserStore as unknown as
								| UserStore
								| undefined
							const currentId = userStore?.getCurrentUser?.()?.id
							if (
								currentId &&
								(profile.userId === currentId || profile.id === currentId)
							) {
								const colors = colorsFromSettings(settings)
								if (colors) {
									profile.themeColors = colors
									profile.premiumType = 2
									return profile
								}
							}

							const colors = decodeColors(profile.bio)
							if (!colors) return profile

							profile.themeColors = colors
							profile.premiumType = 2
						} catch {}

						return profile
					}),
				)
			}),
		)
	},
	SettingsComponent,
})
