export const PLATFORM_KEYS = [
	'twitter',
	'x',
	'tiktok',
	'bluesky',
	'instagram',
	'reddit',
	'threads',
	'pixiv',
] as const

export type PlatformKey = (typeof PLATFORM_KEYS)[number]

export interface PlatformSetting {
	enabled: boolean
	domain: string
}

export interface Settings {
	enabled: boolean
	rewriteEdits: boolean
	platforms: Record<PlatformKey, PlatformSetting>
}

export interface PlatformInfo {
	key: PlatformKey
	label: string
	source: string
	defaultDomain: string
}

export const PLATFORM_MAP: Record<PlatformKey, PlatformInfo> = {
	twitter: {
		key: 'twitter',
		label: 'Twitter',
		source: 'twitter.com links',
		defaultDomain: 'fxtwitter.com',
	},
	x: {
		key: 'x',
		label: 'X',
		source: 'x.com links',
		defaultDomain: 'fixupx.com',
	},
	tiktok: {
		key: 'tiktok',
		label: 'TikTok',
		source: 'tiktok.com links',
		defaultDomain: 'tnktok.com',
	},
	bluesky: {
		key: 'bluesky',
		label: 'Bluesky',
		source: 'bsky.app links',
		defaultDomain: 'fxbsky.app',
	},
	instagram: {
		key: 'instagram',
		label: 'Instagram',
		source: 'instagram.com links',
		defaultDomain: 'ddinstagram.com',
	},
	reddit: {
		key: 'reddit',
		label: 'Reddit',
		source: 'reddit.com links',
		defaultDomain: 'redditez.com',
	},
	threads: {
		key: 'threads',
		label: 'Threads',
		source: 'threads.net and threads.com links',
		defaultDomain: 'fixthreads.net',
	},
	pixiv: {
		key: 'pixiv',
		label: 'Pixiv',
		source: 'pixiv.net links',
		defaultDomain: 'phixiv.net',
	},
}

export const PLATFORMS: PlatformInfo[] = PLATFORM_KEYS.map(
	key => PLATFORM_MAP[key],
)

function setting(enabled: boolean, domain: string): PlatformSetting {
	return { enabled, domain }
}

export const DefaultSettings: Settings = {
	enabled: true,
	rewriteEdits: true,
	platforms: {
		twitter: setting(true, 'fxtwitter.com'),
		x: setting(true, 'fixupx.com'),
		tiktok: setting(true, 'tnktok.com'),
		bluesky: setting(true, 'fxbsky.app'),
		instagram: setting(true, 'ddinstagram.com'),
		reddit: setting(true, 'redditez.com'),
		threads: setting(false, 'fixthreads.net'),
		pixiv: setting(false, 'phixiv.net'),
	},
}

export function mergeSettings(value?: Partial<Settings> | null): Settings {
	const saved = value ?? {}
	const platforms = { ...DefaultSettings.platforms }

	for (const key of PLATFORM_KEYS) {
		const current = saved.platforms?.[key]
		platforms[key] = { ...DefaultSettings.platforms[key], ...(current ?? {}) }
	}

	return { ...DefaultSettings, ...saved, platforms }
}

export interface Replacement {
	origin: string
	prefix: string
	host: string
}

/**
 * Accepts a bare domain, a full URL, or an instance URL with a path prefix.
 * Query strings and fragments are ignored because link fixers expect the
 * original post path to be appended.
 */
export function normalizeReplacement(
	raw: string | undefined,
	fallback: string,
): Replacement | undefined {
	const value = (raw ?? '').trim() || fallback.trim()
	if (!value) return undefined

	let parsed: URL
	try {
		parsed = new URL(value)
	} catch {
		try {
			parsed = new URL(`https://${value}`)
		} catch {
			return undefined
		}
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
		return undefined
	if (parsed.username || parsed.password) return undefined

	const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
	if (!host) return undefined

	const prefix = parsed.pathname.replace(/\/+$/, '')
	if (prefix.includes('..') || prefix.includes('//')) return undefined

	return { origin: parsed.origin, prefix, host }
}

function isHost(host: string, exact: string): boolean {
	const value = host.toLowerCase().replace(/\.$/, '')
	return value === exact || value.endsWith(`.${exact}`)
}

export function matchesPlatform(host: string, key: PlatformKey): boolean {
	switch (key) {
		case 'twitter':
			return isHost(host, 'twitter.com')
		case 'x':
			return isHost(host, 'x.com')
		case 'tiktok':
			return isHost(host, 'tiktok.com')
		case 'bluesky':
			return isHost(host, 'bsky.app')
		case 'instagram':
			return isHost(host, 'instagram.com')
		case 'reddit':
			return isHost(host, 'reddit.com')
		case 'threads':
			return isHost(host, 'threads.net') || isHost(host, 'threads.com')
		case 'pixiv':
			return isHost(host, 'pixiv.net')
	}
}

const URL_PATTERN = /\b(https?:\/\/)([^\s<>"'`]+)/gi
const TRAILING_PUNCTUATION = /[.,;:!)\]}]+$/

export function rewriteContent(content: string, settings: Settings): string {
	if (!settings.enabled || !content.includes('://')) return content

	const active = PLATFORM_KEYS.filter(key => settings.platforms[key]?.enabled)
	if (active.length === 0) return content

	const replacements = new Map<PlatformKey, Replacement>()
	const knownFixedHosts = new Set<string>()

	for (const key of PLATFORM_KEYS) {
		const info = PLATFORM_MAP[key]
		try {
			knownFixedHosts.add(new URL(`https://${info.defaultDomain}`).hostname)
		} catch {}

		const replacement = normalizeReplacement(
			settings.platforms[key]?.domain,
			info.defaultDomain,
		)
		if (!replacement) continue

		knownFixedHosts.add(replacement.host)
		if (settings.platforms[key]?.enabled) replacements.set(key, replacement)
	}

	if (replacements.size === 0) return content

	return content.replace(URL_PATTERN, match => {
		let candidate = match
		let suffix = ''
		const trailing = candidate.match(TRAILING_PUNCTUATION)?.[0]
		if (trailing) {
			suffix = trailing
			candidate = candidate.slice(0, -trailing.length)
		}

		let url: URL
		try {
			url = new URL(candidate)
		} catch {
			return match
		}

		if (url.protocol !== 'http:' && url.protocol !== 'https:') return match

		const host = url.hostname.toLowerCase().replace(/\.$/, '')
		if (knownFixedHosts.has(host)) return match

		const platform = active.find(key => matchesPlatform(host, key))
		if (!platform) return match

		const replacement = replacements.get(platform)
		if (!replacement || replacement.host === host) return match

		const path =
			url.pathname === '/' && replacement.prefix === '' ? '' : url.pathname
		return `${replacement.origin}${replacement.prefix}${path}${url.search}${url.hash}${suffix}`
	})
}
