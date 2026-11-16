import { getStore } from '@valenced/discord/flux'
import { after } from '@valenced/patcher'
import { setupBuilder, setupColorPicker } from './builder'
import { currentColors, currentUserId } from './colors'
import { setupSaveProfile } from './save-profile'
import SettingsComponent from './settings'
import { DefaultSettings, decodeColors } from './shared'
import { currentSettings, setStorage } from './state'
import { setupThemePreview } from './theme-preview'
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

/**
 * The patched profile object is mutated in place, so after the first patch
 * profile.themeColors is no longer a reliable sign that the user has real
 * Nitro colors. Remember the original value per profile object instead.
 */
const originalThemeColors = new WeakMap<object, number[] | null>()

function getOriginalThemeColors(profile: UserProfile): number[] | null {
	const cached = originalThemeColors.get(profile)
	if (cached !== undefined) return cached

	const original = profile.themeColors ?? null
	originalThemeColors.set(profile, original)
	return original
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
		setupSaveProfile(cleanup)
		setupThemePreview(cleanup)

		cleanup(
			getStore<UserProfileStore>('UserProfileStore', store => {
				cleanup(
					after(store, 'getUserProfile', (profile: UserProfile | undefined) => {
						if (!profile || profile.profileFetchFailed) return profile

						try {
							const settings = currentSettings()
							const ownId = currentUserId()
							const isCurrentUser =
								ownId != null &&
								(profile.userId === ownId || profile.id === ownId)

							// Always show the colors picked in the plugin on your own
							// profile, even if the cached profile already has theme
							// colors from an earlier patch.
							if (isCurrentUser) {
								const colors = currentColors()
								if (colors) {
									profile.themeColors = colors
									profile.premiumType = 2
									return profile
								}
							}

							// Only keep real Nitro colors of other profiles.
							if (settings.nitroFirst && getOriginalThemeColors(profile)) {
								return profile
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
