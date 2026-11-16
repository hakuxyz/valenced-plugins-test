import { Stores } from '@valenced/discord/flux'
import { hexToNumber } from './shared'
import { currentSettings } from './state'

interface UserStore {
	getCurrentUser(): { id: string } | undefined
}

interface UserProfileStore {
	getUserProfile(userId: string): { bio?: string | null } | undefined
}

export function currentColors(): [number, number] | null {
	const settings = currentSettings()
	const primary = hexToNumber(settings.primary)
	const accent = hexToNumber(settings.accent)

	return primary == null || accent == null ? null : [primary, accent]
}

export function currentUserId(): string | undefined {
	const store = Stores.UserStore as unknown as UserStore | undefined
	return store?.getCurrentUser?.()?.id
}

export function currentProfileBio(): string | null | undefined {
	const store = Stores.UserProfileStore as unknown as
		| UserProfileStore
		| undefined
	const id = currentUserId()
	if (!store || !id) return undefined

	try {
		return store.getUserProfile?.(id)?.bio
	} catch {
		return undefined
	}
}
