import { getStore, Stores } from '@valenced/discord/flux'
import { instead } from '@valenced/patcher'
import SettingsComponent from './settings'
import {
	DefaultSettings,
	isNitroBadge,
	isNitroBasicType,
	isNitroPremiumType,
	isStarterPeriod,
	OG_NITRO_ICON,
} from './shared'
import type { AnyFunction } from '@valenced/utils/types'
import type { Settings } from './shared'

interface ProfileBadgeLike {
	id?: string
	description?: string
	icon?: string
	link?: string
	[key: string]: unknown
}

interface UserProfileLike {
	userId?: string
	id?: string
	badges?: ProfileBadgeLike[]
	premiumType?: unknown
	premiumSince?: unknown
	premiumGuildSince?: unknown
	[key: string]: unknown
}

interface UserProfileStoreLike {
	getUserProfile?(userId: string): UserProfileLike | null | undefined
	getGuildMemberProfile?(
		userId: string,
		guildId?: string,
	): UserProfileLike | null | undefined
	[key: string]: unknown
}

type Instead = (args: unknown[], original: AnyFunction) => unknown

const insteadLoose = instead as unknown as (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: Instead,
) => () => boolean

function currentSettings(storage: any): Settings {
	try {
		const cached =
			storage?.cache ??
			(typeof storage?.get === 'function' ? storage.get() : undefined) ??
			storage?.data ??
			{}
		return {
			...DefaultSettings,
			...cached,
			affectYourBadges:
				cached?.affectYourBadges ??
				cached?.affectYourBanners ??
				DefaultSettings.affectYourBadges,
		}
	} catch {
		return DefaultSettings
	}
}

function cloneProfile(profile: UserProfileLike): UserProfileLike {
	try {
		return { ...profile }
	} catch {
		return profile
	}
}

function resolvePremiumType(profile: UserProfileLike): unknown {
	if (profile?.premiumType != null) return profile.premiumType
	return undefined
}

function currentUserId(): string | undefined {
	try {
		return (Stores as any)?.UserStore?.getCurrentUser?.()?.id
	} catch {
		return undefined
	}
}

function isOwnProfile(profile: UserProfileLike): boolean {
	const id = currentUserId()
	if (!id) return false
	return profile?.userId === id || profile?.id === id
}

function shouldAffectProfile(
	profile: UserProfileLike,
	settings: Settings,
): { kind: 'basic' | 'premium' } | undefined {
	const premiumType = resolvePremiumType(profile)
	const premiumSince = profile?.premiumSince ?? profile?.premiumGuildSince

	if (settings.applyNitroBasic && isNitroBasicType(premiumType)) {
		return { kind: 'basic' }
	}

	if (settings.applyNitroPremium && isNitroPremiumType(premiumType)) {
		return { kind: 'premium' }
	}

	// Fallback: if premium type is unknown but Nitro badge is present, treat as
	// premium-subscription badge and apply enabled toggles conservatively.
	if (Array.isArray(profile?.badges) && profile.badges.some(isNitroBadge)) {
		const starter = isStarterPeriod(premiumSince)
		// Without a clear type, avoid removing badges unless explicitly premium.
		if (settings.applyNitroBasic || settings.applyNitroPremium) {
			return { kind: starter ? 'basic' : 'premium' }
		}
	}

	return undefined
}

function transformBadges(
	badges: ProfileBadgeLike[] | undefined,
	kind: 'basic' | 'premium',
	settings: Settings,
	premiumSince: unknown,
): ProfileBadgeLike[] | undefined {
	if (!Array.isArray(badges)) return badges

	let changed = false
	const out: ProfileBadgeLike[] = []

	for (const badge of badges) {
		if (!isNitroBadge(badge)) {
			out.push(badge)
			continue
		}

		if (kind === 'basic') {
			if (settings.applyNitroBasic) {
				changed = true
				out.push({ ...badge, icon: OG_NITRO_ICON })
				continue
			}
			out.push(badge)
			continue
		}

		// premium
		if (!settings.applyNitroPremium) {
			out.push(badge)
			continue
		}

		if (settings.premiumMode === 'removeEvolved') {
			// Only replace the starter badge and keep other evolved badges.
			if (isStarterPeriod(premiumSince)) {
				changed = true
				out.push({ ...badge, icon: OG_NITRO_ICON })
			} else {
				out.push(badge)
			}
			continue
		}

		// original/starter icon
		changed = true
		out.push({ ...badge, icon: OG_NITRO_ICON })
	}

	return changed ? out : badges
}

function nudgePremiumSinceToRecent(profile: UserProfileLike) {
	try {
		const recent = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
		if (profile.premiumSince) profile.premiumSince = recent
		if (profile.premiumGuildSince) profile.premiumGuildSince = recent
	} catch {}
}

function transformProfile(
	profile: UserProfileLike | null | undefined,
	storage: any,
): UserProfileLike | null | undefined {
	if (!profile || typeof profile !== 'object') return profile

	try {
		const settings = currentSettings(storage)
		if (!settings.applyNitroBasic && !settings.applyNitroPremium) return profile

		const target = shouldAffectProfile(profile, settings)
		if (!target) return profile

		const ownProfile = isOwnProfile(profile)
		const affectOwnBadges = !ownProfile || settings.affectYourBadges

		const premiumSince = profile.premiumSince ?? profile.premiumGuildSince
		const nextBadges = affectOwnBadges
			? transformBadges(profile.badges, target.kind, settings, premiumSince)
			: profile.badges

		const next = nextBadges === profile.badges ? profile : cloneProfile(profile)
		let changed = nextBadges !== profile.badges

		if (nextBadges !== profile.badges) {
			;(next as UserProfileLike).badges = nextBadges
		}

		// When enabled, nudge tenure back locally so areas that derive
		// Nitro evolution from premium tenure (such as Your badges) can show
		// the original/starter state for forced-original behavior.
		if (affectOwnBadges && target.kind === 'premium') {
			if (settings.premiumMode === 'original') {
				const beforeSince = (next as UserProfileLike).premiumSince
				const beforeGuildSince = (next as UserProfileLike).premiumGuildSince
				nudgePremiumSinceToRecent(next as UserProfileLike)
				if (
					beforeSince !== (next as UserProfileLike).premiumSince ||
					beforeGuildSince !== (next as UserProfileLike).premiumGuildSince
				) {
					changed = true
					if (next === profile) {
						const cloned = cloneProfile(profile)
						cloned.badges = nextBadges
						nudgePremiumSinceToRecent(cloned)
						return cloned
					}
				}
			} else if (
				settings.premiumMode === 'removeEvolved' &&
				isStarterPeriod(premiumSince)
			) {
				const beforeSince = (next as UserProfileLike).premiumSince
				const beforeGuildSince = (next as UserProfileLike).premiumGuildSince
				nudgePremiumSinceToRecent(next as UserProfileLike)
				if (
					beforeSince !== (next as UserProfileLike).premiumSince ||
					beforeGuildSince !== (next as UserProfileLike).premiumGuildSince
				) {
					changed = true
					if (next === profile) {
						const cloned = cloneProfile(profile)
						cloned.badges = nextBadges
						nudgePremiumSinceToRecent(cloned)
						return cloned
					}
				}
			}
		}

		return changed ? (next as UserProfileLike) : profile
	} catch {
		return profile
	}
}

function patchMethod(
	cleanup: (...fns: Array<() => unknown>) => void,
	store: UserProfileStoreLike,
	method: 'getUserProfile' | 'getGuildMemberProfile',
	storage: any,
) {
	try {
		if (typeof store?.[method] !== 'function') return
		cleanup(
			insteadLoose(
				store as unknown as Record<string, AnyFunction>,
				method,
				(args, original) => {
					const profile = original(...args) as
						| UserProfileLike
						| null
						| undefined
					return transformProfile(profile, storage)
				},
			),
		)
	} catch {}
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start({ cleanup, jsonStorage }) {
		cleanup(
			getStore<UserProfileStoreLike>('UserProfileStore', store => {
				patchMethod(cleanup, store, 'getUserProfile', jsonStorage)
				patchMethod(cleanup, store, 'getGuildMemberProfile', jsonStorage)
			}),
		)
	},
	SettingsComponent,
})
