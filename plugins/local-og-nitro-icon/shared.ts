export type PremiumMode = 'original' | 'removeEvolved'

export interface Settings {
	applyNitroBasic: boolean
	applyNitroPremium: boolean
	premiumMode: PremiumMode
	affectYourBadges: boolean
}

export const DefaultSettings: Settings = {
	applyNitroBasic: true,
	applyNitroPremium: true,
	premiumMode: 'original',
	affectYourBadges: true,
}

// Classic/original Nitro subscriber badge icon (before evolution).
export const OG_NITRO_ICON = '2ba85e8026a8614b640c2837bcdfe21b'

export function isNitroPremiumType(premiumType: unknown): boolean {
	// 1: Nitro Classic, 2: Nitro
	return premiumType === 1 || premiumType === 2
}

export function isNitroBasicType(premiumType: unknown): boolean {
	// 3: Nitro Basic
	return premiumType === 3
}

export function toDate(value: unknown): Date | undefined {
	if (!value) return undefined
	if (value instanceof Date) {
		return Number.isFinite(value.getTime()) ? value : undefined
	}
	if (typeof value === 'number') {
		const d = new Date(value)
		return Number.isFinite(d.getTime()) ? d : undefined
	}
	if (typeof value === 'string') {
		const d = new Date(value)
		return Number.isFinite(d.getTime()) ? d : undefined
	}
	return undefined
}

export function isStarterPeriod(premiumSince: unknown): boolean {
	const since = toDate(premiumSince)
	if (!since) return false
	const now = Date.now()
	const diff = now - since.getTime()
	if (diff < 0) return true
	// Treat < ~1 month as starter/before evolution.
	return diff < 30 * 24 * 60 * 60 * 1000
}

export function isNitroBadge(badge: any): boolean {
	if (!badge || typeof badge !== 'object') return false
	const id = typeof badge.id === 'string' ? badge.id.toLowerCase() : ''
	const link = typeof badge.link === 'string' ? badge.link.toLowerCase() : ''
	const description =
		typeof badge.description === 'string' ? badge.description.toLowerCase() : ''

	if (id === 'premium' || id.includes('nitro')) return true
	if (link.includes('/settings/premium')) return true
	if (description.includes('nitro') || description.includes('subscriber'))
		return true
	return false
}
