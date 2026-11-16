import { getStore } from '@valenced/discord/flux'
import { instead } from '@valenced/patcher'
import { setupColorPicker } from './color-picker'
import { currentColors, currentUserId } from './colors'
import SettingsComponent from './settings'
import { DefaultSettings, decodeColors } from './shared'
import { currentSettings, setStorage } from './state'
import { setupThemePreview } from './theme-preview'
import type { AnyFunction } from '@valenced/utils/types'
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

type Instead = (args: unknown[], original: AnyFunction) => unknown

const insteadLoose = instead as unknown as (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: Instead,
) => () => boolean

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

function isCurrentUser(
	requestedId: unknown,
	profile: UserProfile | undefined,
): boolean {
	const ownId = currentUserId()
	if (ownId == null) return false

	return (
		requestedId === ownId || profile?.userId === ownId || profile?.id === ownId
	)
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start({ cleanup, jsonStorage }) {
		setStorage(jsonStorage)
		setupColorPicker(cleanup)
		setupThemePreview(cleanup)

		cleanup(
			getStore<UserProfileStore>('UserProfileStore', store => {
				cleanup(
					insteadLoose(
						store as unknown as Record<string, AnyFunction>,
						'getUserProfile',
						(args, original) => {
							const profile = original(...args) as UserProfile | undefined
							if (!profile || profile.profileFetchFailed) return profile

							try {
								const settings = currentSettings()

								// Always show the colors picked in the plugin on your
								// own profile, even if the cached profile already has
								// theme colors from an earlier patch.
								if (isCurrentUser(args[0], profile)) {
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
						},
					),
				)
			}),
		)
	},
	SettingsComponent,
})
