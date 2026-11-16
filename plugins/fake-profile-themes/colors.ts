import { Stores } from '@valenced/discord/flux'
import { DefaultSettings, hexToNumber } from './shared'
import { storage } from './state'

interface UserStore {
	getCurrentUser(): { id: string } | undefined
}

export function currentColors(): [number, number] | null {
	const settings = { ...DefaultSettings, ...(storage?.cache ?? {}) }
	const primary = hexToNumber(settings.primary)
	const accent = hexToNumber(settings.accent)

	return primary == null || accent == null ? null : [primary, accent]
}

export function currentUserId(): string | undefined {
	const store = Stores.UserStore as unknown as UserStore | undefined
	return store?.getCurrentUser?.()?.id
}
