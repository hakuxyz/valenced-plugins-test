import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { after, before, instead } from '@valenced/patcher'
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

type LooseInstead = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (args: any[], original: AnyFunction) => any,
) => () => boolean

const beforeLoose = before as unknown as LooseBefore
const afterLoose = after as unknown as LooseAfter
const insteadLoose = instead as unknown as LooseInstead

const URL_KEYS = ['url', 'proxy_url', 'proxyURL', 'proxyUrl', 'uri'] as const
const RESIZE_PARAMS = ['width', 'height', 'size', 'quality', 'format'] as const
const SMALL_LIMITS = [128, 256, 512] as const
const MEDIA_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net'])
const MEDIA_PATH = /^\/(?:attachments|ephemeral-attachments|external)\//
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp|avif)(?:\?|$)/i
const TAP_HANDLER = /^handleTap(?:.*)(?:Embed|Image|Media|Attachment)$/i

let openMediaModal: ((props: any) => void) | undefined
const convertedRows = new Map<
	string,
	{
		url: string
		width?: number
		height?: number
		guildId?: string
		channelId?: string
	}
>()
const convertedUrls = new Map<
	string,
	{
		url: string
		width?: number
		height?: number
		guildId?: string
		channelId?: string
	}
>()

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

function rememberConverted(
	message: Record<string, any>,
	attachment: Record<string, any>,
	url: string,
): void {
	const id = message.id ?? message.messageId ?? message.message_id
	if (id == null || id === '') return

	const width = positiveNumber(attachment.width)
	const height = positiveNumber(attachment.height)
	const guildId =
		message.guild_id ?? message.guildId ?? message.guildID ?? undefined
	const channelId =
		message.channel_id ?? message.channelId ?? message.channelID ?? undefined

	const source = {
		url,
		width,
		height,
		guildId: guildId == null ? undefined : String(guildId),
		channelId: channelId == null ? undefined : String(channelId),
	}
	convertedRows.set(String(id), source)
	convertedUrls.set(url, source)

	if (convertedRows.size > 100) {
		const first = convertedRows.keys().next().value
		if (first !== undefined) convertedRows.delete(first)
	}
	if (convertedUrls.size > 100) {
		const first = convertedUrls.keys().next().value
		if (first !== undefined) convertedUrls.delete(first)
	}
}

function openConvertedMedia(event: any): boolean {
	if (!openMediaModal || !isRecord(event)) return false

	const messageId =
		event.messageId ??
		event.message_id ??
		event.message?.id ??
		event.id ??
		event.nativeEvent?.messageId ??
		event.nativeEvent?.message_id
	const byId =
		messageId == null ? undefined : convertedRows.get(String(messageId))

	const eventUrl =
		(typeof event.url === 'string' && event.url) ||
		(typeof event.sourceURI === 'string' && event.sourceURI) ||
		(typeof event.uri === 'string' && event.uri) ||
		(typeof event.nativeEvent?.url === 'string' && event.nativeEvent.url)
	const byUrl = eventUrl ? convertedUrls.get(eventUrl) : undefined

	const source = byId ?? byUrl
	if (!source) return false

	const pageX = positiveNumber(event.pageX ?? event.nativeEvent?.pageX)
	const pageY = positiveNumber(event.pageY ?? event.nativeEvent?.pageY)

	try {
		openMediaModal({
			initialSources: [
				{
					uri: source.url,
					sourceURI: source.url,
					width: source.width,
					height: source.height,
					guildId: source.guildId,
					channelId: source.channelId,
				},
			],
			initialIndex: 0,
			originLayout: {
				width: source.width ?? 0,
				height: source.height ?? 0,
				x: pageX ?? 0,
				y: pageY ?? 0,
				resizeMode: 'fill',
			},
		})
		return true
	} catch {
		return false
	}
}

function isAnimated(
	attachment: Record<string, any>,
	url: string | undefined,
): boolean {
	if (attachment.animated === true || attachment.isAnimated === true)
		return true

	const type = attachment.content_type ?? attachment.contentType
	if (type === 'image/gif') return true

	return (
		/\.gif(?:\?|$)/i.test(String(attachment.filename ?? '')) ||
		(!!url && /\.gif(?:\?|$)/i.test(url))
	)
}

function contentTypeFor(url: string): string {
	const ext = url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1]?.toLowerCase()
	switch (ext) {
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg'
		case 'gif':
			return 'image/gif'
		case 'webp':
			return 'image/webp'
		case 'bmp':
			return 'image/bmp'
		case 'avif':
			return 'image/avif'
		default:
			return 'image/png'
	}
}

function imageEmbed(
	url: string,
	width: number | undefined,
	height: number | undefined,
	animated: boolean,
) {
	const animatedFields = {
		srcIsAnimated: animated,
		srclsAnimated: animated,
	}
	const mediaFields = {
		contentType: contentTypeFor(url),
		placeholder: '',
		placeholderVersion: 1,
		flags: animated ? 1 : 0,
	}
	const image: Record<string, unknown> = {
		url,
		proxyURL: url,
		...animatedFields,
		...mediaFields,
	}
	if (width !== undefined) image.width = width
	if (height !== undefined) image.height = height

	return {
		type: 'image',
		spoiler: '',
		url,
		...animatedFields,
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
					isAnimated(item, originalUrl),
				),
			)
			rememberConverted(message, item, url)
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

function resolveHandlers(exports: any): any {
	const candidates = [
		exports?.MessagesHandlers,
		exports?.default?.MessagesHandlers,
		exports?.default,
		exports,
	]
	for (const candidate of candidates) {
		if (
			candidate?.prototype &&
			typeof candidate.prototype === 'object' &&
			Object.getOwnPropertyNames(candidate.prototype).some(key =>
				TAP_HANDLER.test(key),
			)
		) {
			return candidate
		}
	}
	return undefined
}

function installTapHandlers(exports: any, cleanup: Cleanup): void {
	const Handlers = resolveHandlers(exports)
	const target = Handlers?.prototype
	if (!target) return

	const keys = Object.getOwnPropertyNames(target).filter(
		key => TAP_HANDLER.test(key) && typeof target[key] === 'function',
	)

	for (const key of keys) {
		const original = target[key] as AnyFunction
		if (patched.has(original)) continue

		try {
			ensureWritable(target, key)
			patched.add(original)

			const unpatch = insteadLoose(target, key, (args, originalFn) => {
				const event = args?.[0]?.nativeEvent ?? args?.[0]
				try {
					if (openConvertedMedia(event)) return undefined
				} catch {}
				return originalFn(...args)
			})

			cleanup(() => {
				patched.delete(original)
				unpatch()
			})
		} catch {
			patched.delete(original)
		}
	}
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},

	start({ cleanup, jsonStorage }) {
		setStorage(jsonStorage)

		cleanup(() => {
			openMediaModal = undefined
			convertedRows.clear()
			convertedUrls.clear()
		})

		cleanup(
			getModules(
				withProps('openMediaModal'),
				exports => {
					const opener =
						exports?.openMediaModal ??
						(typeof exports === 'function' ? exports : undefined)
					if (typeof opener === 'function') openMediaModal = opener
				},
				{ max: 5 },
			),
		)

		cleanup(
			getModules(
				withName('MediaModal'),
				raw => {
					const exports = raw as any
					const opener =
						exports?.openMediaModal ??
						exports?.default?.openMediaModal ??
						(typeof exports === 'function' ? exports : undefined)
					if (!openMediaModal && typeof opener === 'function')
						openMediaModal = opener
				},
				{ max: 5 },
			),
		)

		cleanup(
			getModules(
				withProps('MessagesHandlers'),
				exports => installTapHandlers(exports, cleanup),
				{ max: 5 },
			),
		)

		cleanup(
			getModules(withName('RowManager'), exports => install(exports, cleanup), {
				max: 5,
			}),
		)
	},

	SettingsComponent,
})
