import { Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { after, before } from '@valenced/patcher'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import { currentSettings, setStorage } from './state'
import type { AnyFunction } from '@valenced/utils/types'
import type { Settings } from './shared'

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

const REAL_IS_FIRST = 'vd_cm_realIsFirst'
const BRAND_COLOR = 0x5865f2
const SUPPORTED_TYPES = new Set([0, 19, 20])

interface AstNode {
	type: string
	content?: unknown
	[key: string]: unknown
}

interface RowData {
	rowType?: unknown
	isFirst?: unknown
	message?: any
	[REAL_IS_FIRST]?: unknown
	[key: string]: unknown
}

interface RowResult {
	renderContentOnly?: unknown
	message?: any
	[key: string]: unknown
}

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

function isMessageRow(
	data: RowData | undefined,
): data is RowData & { message: any } {
	return (
		data?.rowType === 1 && !!data.message && typeof data.message === 'object'
	)
}

function textNode(content: string): AstNode {
	return { content, type: 'text' }
}

function toColorInt(value: unknown, fallback = BRAND_COLOR): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0
	if (typeof value !== 'string') return fallback

	const trimmed = value.trim()
	if (/^[0-9]+$/.test(trimmed)) {
		const parsed = Number(trimmed)
		return Number.isFinite(parsed) ? parsed >>> 0 : fallback
	}

	const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
	if (hex.length === 3 && /^[\da-f]{3}$/i.test(hex)) {
		return Number.parseInt(
			hex
				.split('')
				.map(char => char + char)
				.join(''),
			16,
		)
	}
	if ((hex.length === 6 || hex.length === 8) && /^[\da-f]+$/i.test(hex)) {
		return Number.parseInt(hex.slice(0, 6), 16)
	}
	return fallback
}

function hexColor(value: number): string {
	return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`
}

function store(name: string): any {
	try {
		return (Stores as unknown as Record<string, any>)[name]
	} catch {
		return undefined
	}
}

function timestampText(raw: any, full: boolean): string {
	try {
		const custom = raw?.__customTimestamp
		if (full && custom != null) return String(custom)

		const timestamp = raw?.timestamp
		if (typeof timestamp === 'string') return timestamp
		if (!timestamp || typeof timestamp !== 'object') return ''

		if (typeof timestamp.calendar === 'function' && !full) {
			const calendar = timestamp.calendar()
			if (typeof calendar === 'string') return calendar
		}
		if (typeof timestamp.format === 'function') {
			const formatted = timestamp.format(full ? 'HH:mm:ss' : 'LT')
			if (typeof formatted === 'string') return formatted
		}
		if (timestamp instanceof Date) return timestamp.toLocaleTimeString()
	} catch {}
	return ''
}

function timestampNode(content: string): AstNode {
	return { content, type: 'inlineCode' }
}

function mentionNode(label: string, color: number): AstNode {
	return {
		content: [{ content: label, type: 'inlineCode' }],
		type: 'mention',
		roleColor: color,
		color,
		colorString: hexColor(color),
	}
}

function avatarNode(url: string): AstNode {
	return { guildId: '0', content: '', icon: url, type: 'guild' }
}

function avatarUrl(raw: any): string | undefined {
	try {
		const author = raw?.author
		const userId = author?.id
		if (!userId) return undefined

		const member = store('GuildMemberStore')?.getMember?.(raw?.guildId, userId)
		if (member?.avatar && raw?.guildId) {
			const extension = String(member.avatar).startsWith('a_') ? 'gif' : 'png'
			return `https://cdn.discordapp.com/guilds/${raw.guildId}/users/${userId}/avatars/${member.avatar}.${extension}?size=32`
		}

		if (author.avatar == null) return undefined
		const hash = String(author.avatar)
		const extension = hash.startsWith('a_') ? 'gif' : 'png'
		return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${extension}?size=32`
	} catch {
		return undefined
	}
}

function displayName(out: any, raw: any): string {
	const rendered = typeof out?.username === 'string' ? out.username : undefined
	const authorName =
		typeof raw?.author?.username === 'string' ? raw.author.username : undefined
	let name = rendered ?? authorName ?? ''

	if (name && name === authorName) {
		name = raw?.nick ?? raw?.author?.globalName ?? name
	}

	if (!name) {
		name =
			raw?.author?.globalName ??
			raw?.nick ??
			out?.nick ??
			out?.author?.globalName ??
			raw?.authorId ??
			raw?.author?.id ??
			out?.author?.id ??
			''
	}

	return String(name || 'Unknown')
}

function usernameTextNode(name: string): AstNode {
	return {
		content: [{ content: name, type: 'text' }],
		type: 'strong',
	}
}

function usernameNode(out: any, raw: any): AstNode {
	return usernameTextNode(displayName(out, raw))
}

function iconRoleNodes(raw: any, settings: Settings): AstNode[] {
	if (!settings.noInline) return []

	try {
		const member = store('GuildMemberStore')?.getMember?.(
			raw?.guildId,
			raw?.author?.id,
		)
		const roleId = member?.iconRoleId
		if (!roleId) return []

		const role = store('GuildStore')?.getGuild?.(raw?.guildId)?.roles?.[roleId]
		if (role?.unicodeEmoji)
			return [textNode(' '), textNode(String(role.unicodeEmoji))]
		if (role?.icon) {
			const url = `https://cdn.discordapp.com/role-icons/${roleId}/${role.icon}.png?size=32`
			return [textNode(' '), avatarNode(url)]
		}
	} catch {}
	return []
}

function buildHeader(out: any, raw: any, settings: Settings): AstNode[] {
	const nodes: AstNode[] = []
	const timestamp = timestampText(raw, settings.inlineTimestamps)
	const roleColor = toColorInt(raw?.tagBackgroundColor)

	if (timestamp && !settings.noInline) {
		nodes.push(timestampNode(timestamp), textNode(' '))
	}
	if (settings.avatars) {
		const url = avatarUrl(raw)
		if (url) nodes.push(avatarNode(url), textNode(' '))
	}
	if (raw?.tagText && !settings.noInline) {
		nodes.push(mentionNode(String(raw.tagText), roleColor), textNode(' '))
	}

	nodes.push(usernameNode(out, raw))

	if (settings.noInline) {
		nodes.push(...iconRoleNodes(raw, settings))
		if (raw?.tagText) {
			nodes.push(textNode(' '), mentionNode(String(raw.tagText), roleColor))
		}
		if (timestamp) nodes.push(textNode(' '), timestampNode(timestamp))
	}
	return nodes
}

function disableJumboable(nodes: unknown): void {
	if (!Array.isArray(nodes)) return
	for (const node of nodes) {
		if (!node || typeof node !== 'object') continue
		const current = node as AstNode
		if (current.type === 'emoji' || current.type === 'customEmoji') {
			current.jumboable = false
		}
		if (Array.isArray(current.content)) disableJumboable(current.content)
	}
}

function hideReplyAvatar(out: any, settings: Settings): void {
	if (!settings.noReplyAvatars) return

	const reference = out?.referencedMessage?.message
	if (!reference || typeof reference !== 'object') return

	reference.avatarURL = undefined
	const name = typeof reference.username === 'string' ? reference.username : ''
	if (!name) return

	const nameNode = usernameTextNode(name)

	const parent = out.referencedMessage
	if (parent.systemContent) {
		const system = String(parent.systemContent)
		parent.systemContent = undefined
		if (!Array.isArray(reference.content)) reference.content = []
		reference.content.push({
			content: [{ content: system, type: 'text' }],
			type: 'em',
		})

		const icon = reference.attachments?.length
			? '\u{1F5BC}'
			: reference.stickers?.length
				? '\u2728'
				: reference.embeds?.length
					? '\u{1F5D2}'
					: undefined
		if (icon) reference.content.push(textNode(' '), textNode(icon))
	}

	const content = Array.isArray(reference.content) ? reference.content : []
	reference.content = [nameNode, textNode(' '), ...content]
}

function transform(result: any, data: RowData | undefined): any {
	const settings = currentSettings()
	if (!settings.enabled) return result
	if (!isMessageRow(data) || !result || typeof result !== 'object')
		return result

	const out = result as RowResult
	const outMessage = out.message
	if (!outMessage || typeof outMessage !== 'object') return result

	const type = outMessage.type ?? data.message?.type
	if (!SUPPORTED_TYPES.has(type)) return result

	out.renderContentOnly = true
	outMessage.avatarURL = undefined
	outMessage.shouldShowRoleOnName = true

	if (settings.noInline && !data[REAL_IS_FIRST]) return result

	const header = buildHeader(outMessage, data.message, settings)
	const content = Array.isArray(outMessage.content) ? outMessage.content : []
	if (content.length > 0) header.push(textNode(settings.noInline ? '\n' : ' '))

	if (settings.biggerHeader) {
		outMessage.content = [
			{ level: 3, content: header, type: 'heading' },
			...content,
		]
	} else {
		outMessage.content = [...header, ...content]
	}

	if (!settings.noInline) disableJumboable(outMessage.content)
	hideReplyAvatar(outMessage, settings)
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
			try {
				const settings = currentSettings()
				if (!settings.enabled || !isMessageRow(currentData)) return args
				currentData![REAL_IS_FIRST] = currentData!.isFirst
				currentData!.isFirst = false
				currentData!.message.avatarURL = undefined
			} catch {}
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
