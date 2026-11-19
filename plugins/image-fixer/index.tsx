import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { after, before } from '@valenced/patcher'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import { currentSettings, setStorage } from './state'
import type { AnyFunction } from '@valenced/utils/types'
import type { Settings, SmallImageLimit } from './shared'

type Cleanup = (...fns: Array<() => unknown>) => void

type LooseBefore = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (args: any[]) => any,
) => () => void

type LooseAfter = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (result: any) => any,
) => () => void

const beforeLoose = before as unknown as LooseBefore
const afterLoose = after as unknown as LooseAfter

const URL_KEYS = ['url', 'proxy_url', 'proxyURL', 'proxyUrl', 'uri'] as const
const RESIZE_PARAMS = ['width', 'height', 'size', 'quality', 'format'] as const
const SMALL_LIMITS = [128, 256, 512] as const
const MEDIA_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net'])
const MEDIA_PATH = /^\/(?:attachments|ephemeral-attachments|external)\//
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp|avif)(?:\?|$)/i

interface RowData {
	rowType?: unknown
	[key: string]: unknown
}

interface RowResult {
	message?: any
	[key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null
}

/**
 * Metro re-exports members as getters. Turn such a member into a writable
 * value property so the patcher can hook it.
 */
function ensureWritable(parent: any, key: string): void {
	try {
		const desc = Object.getOwnPropertyDescriptor(parent, key)
		if (!desc || desc.configurable === false) return
		if ('value' in desc && desc.writable) return
		const value = parent[key]
		if (typeof value !== 'function') return
		Object.defineProperty(parent, key, {
			value,
			writable: true,
			enumerable: desc.enumerable,
			configurable: true,
		})
	} catch {}
}

function resolveRowManager(exports: any): any {
	const candidates = [
		exports,
		exports?.default,
		exports?.RowManager,
		exports?.default?.RowManager,
	]
	for (const candidate of candidates) {
		if (
			candidate?.prototype &&
			typeof candidate.prototype.generate === 'function'
		)
			return candidate
	}
	return undefined
}

function pickUrl(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined
	for (const key of URL_KEYS) {
		const candidate = value[key]
		if (typeof candidate === 'string' && candidate) return candidate
	}
	return undefined
}

function normalizeImageUrl(input: unknown): string | undefined {
	if (typeof input !== 'string' || !input) return undefined

	let url: URL
	try {
		url = new URL(input)
	} catch {
		return undefined
	}

	if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined

	const host = url.hostname.toLowerCase()
	if (!MEDIA_HOSTS.has(host) || !MEDIA_PATH.test(url.pathname)) return undefined

	for (const param of RESIZE_PARAMS) url.searchParams.delete(param)
	if (host === 'media.discordapp.net') url.hostname = 'cdn.discordapp.com'

	return url.toString()
}

function withUrl(attachment: Record<string, any>, url: string) {
	const next = { ...attachment }
	for (const key of URL_KEYS) {
		if (key in next) next[key] = url
	}
	if (!('url' in next)) next.url = url
	return next
}

function isImageAttachment(attachment: Record<string, any>, url?: string) {
	const type =
		attachment.attachmentType ??
		attachment.content_type ??
		attachment.contentType
	if (
		type === 'image' ||
		(typeof type === 'string' && type.startsWith('image/'))
	)
		return true
	if (url && IMAGE_EXT.test(url)) return true
	if (
		typeof attachment.filename === 'string' &&
		IMAGE_EXT.test(attachment.filename)
	)
		return true
	return false
}

function positiveNumber(value: unknown): number | undefined {
	const parsed = Number(value)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function limitFor(settings: Settings): number {
	const limit = Number(settings.smallImageLimit) as SmallImageLimit
	return (SMALL_LIMITS as readonly number[]).includes(limit)
		? limit
		: DefaultSettings.smallImageLimit
}

function shouldFix(
	attachment: Record<string, any>,
	settings: Settings,
): boolean {
	if (settings.imageScope === 'all') return true

	const width = positiveNumber(attachment.width)
	const height = positiveNumber(attachment.height)
	if (width === undefined || height === undefined) return true

	return Math.max(width, height) <= limitFor(settings)
}

function isSpoiler(attachment: Record<string, any>): boolean {
	return attachment.spoiler === true || attachment.isSpoiler === true
}

function imageEmbed(url: string, width?: number, height?: number) {
	const image: Record<string, unknown> = { url, proxyURL: url }
	if (width !== undefined) image.width = width
	if (height !== undefined) image.height = height

	return {
		type: 'image',
		spoiler: '',
		url,
		image,
		fields: [],
		borderLeftColor: 0,
		providerColor: 0,
		headerTextColor: 0,
		bodyTextColor: 0,
	}
}

function transform(result: any, data: RowData | undefined): any {
	const settings = currentSettings()
	if (!settings.enabled || data?.rowType !== 1) return result
	if (!isRecord(result) || !isRecord(result.message)) return result

	const out = result as RowResult
	const message = out.message
	const attachments = Array.isArray(message.attachments)
		? message.attachments
		: []
	if (attachments.length === 0) return result

	const targets: Array<Record<string, any>> = []
	for (const item of attachments) {
		if (!isRecord(item)) continue
		const url = pickUrl(item)
		if (url && isImageAttachment(item, url) && shouldFix(item, settings)) {
			targets.push(item)
		}
	}
	if (targets.length === 0) return result

	const convertTarget =
		settings.renderAsLinks && targets.length === 1 && !isSpoiler(targets[0])

	const nextAttachments: any[] = []
	const nextEmbeds: any[] = Array.isArray(message.embeds)
		? [...message.embeds]
		: []
	let changed = false
	let converted = false

	for (const item of attachments) {
		if (!isRecord(item)) {
			nextAttachments.push(item)
			continue
		}

		const originalUrl = pickUrl(item)
		if (
			!originalUrl ||
			!isImageAttachment(item, originalUrl) ||
			!shouldFix(item, settings)
		) {
			nextAttachments.push(item)
			continue
		}

		let url = originalUrl
		if (settings.useOriginalUrls) {
			const normalized = normalizeImageUrl(url)
			if (normalized && normalized !== url) {
				url = normalized
				changed = true
			}
		}

		if (convertTarget && item === targets[0]) {
			nextEmbeds.push(
				imageEmbed(
					url,
					positiveNumber(item.width),
					positiveNumber(item.height),
				),
			)
			converted = true
			changed = true
			continue
		}

		nextAttachments.push(url === originalUrl ? item : withUrl(item, url))
	}

	if (!changed) return result

	if (Object.isFrozen(message)) {
		const nextMessage: Record<string, any> = {
			...message,
			attachments: nextAttachments,
		}
		if (converted || Array.isArray(message.embeds))
			nextMessage.embeds = nextEmbeds
		out.message = nextMessage
		return result
	}

	message.attachments = nextAttachments
	if (converted || Array.isArray(message.embeds)) message.embeds = nextEmbeds
	return result
}

const patched = new Set<AnyFunction>()

function install(exports: any, cleanup: Cleanup): void {
	const RowManager = resolveRowManager(exports)
	if (!RowManager) return

	const target = RowManager.prototype
	const original = target.generate as AnyFunction
	if (typeof original !== 'function' || patched.has(original)) return

	try {
		ensureWritable(target, 'generate')
		patched.add(original)

		let currentData: RowData | undefined
		const unBefore = beforeLoose(target, 'generate', (args: any[]) => {
			currentData = args?.[0] as RowData | undefined
			return args
		})
		const unAfter = afterLoose(target, 'generate', (result: any) => {
			const data = currentData
			currentData = undefined
			try {
				return transform(result, data)
			} catch {
				return result
			}
		})

		cleanup(() => {
			patched.delete(original)
			unBefore()
			unAfter()
		})
	} catch {
		patched.delete(original)
	}
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},

	start({ cleanup, jsonStorage }) {
		setStorage(jsonStorage)

		cleanup(
			getModules(withName('RowManager'), exports => install(exports, cleanup), {
				max: 5,
			}),
		)
	},

	SettingsComponent,
})
