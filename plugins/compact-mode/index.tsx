import { ToastActionCreators } from '@valenced/discord/actions'
import { Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { after, before } from '@valenced/patcher'
import { createElement } from 'react'
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
const USERNAME_MAX = 17

const avatarTapMap = new Map<string, string>()
const usernameTapMap = new Map<string, string>()

let showUserProfile: ((props: any) => void) | undefined
let RN: any

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
			const url = `https://cdn.discordapp.com/guilds/${raw.guildId}/users/${userId}/avatars/${member.avatar}.${extension}?size=32`
			rememberAvatar(url, userId)
			return url
		}

		if (author.avatar == null) return undefined
		const hash = String(author.avatar)
		const extension = hash.startsWith('a_') ? 'gif' : 'png'
		const url = `https://cdn.discordapp.com/avatars/${userId}/${hash}.${extension}?size=32`
		rememberAvatar(url, userId)
		return url
	} catch {
		return undefined
	}
}

function rememberAvatar(url: string, userId: unknown): void {
	if (!url || userId == null) return
	avatarTapMap.set(url, String(userId))
	if (avatarTapMap.size > 200) avatarTapMap.clear()
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

function truncateName(name: string): string {
	return name.length > USERNAME_MAX ? `${name.slice(0, USERNAME_MAX)}...` : name
}

function dumpModulesDiag(): void {
	const names: string[] = []
	const suf: string[] = []
	const pressable: string[] = []
	const chat: string[] = []
	let scanned = 0
	try {
		const unsub = getModules(
			(() => true) as unknown as any,
			(exports: any) => {
				if (exports == null || typeof exports !== 'object') return
				scanned++
				const name = String(exports.name ?? exports.displayName ?? '')
				names.push(name || 'noname')
				const def = exports.default
				if (
					typeof exports.showUserProfile === 'function' ||
					typeof def?.showUserProfile === 'function'
				)
					suf.push(name)
				if (
					typeof exports.Pressable === 'function' ||
					typeof def?.Pressable === 'function'
				)
					pressable.push(name)
				if (/chat/i.test(name)) chat.push(name)
			},
			{ max: 3000 },
		)
		setTimeout(() => {
			try {
				unsub()
			} catch {}
		}, 3000)
	} catch {}
	setTimeout(() => {
		toast(
			`CM-DUMP n=${scanned} suf=[${suf.slice(0, 10).join('|')}] p=[${pressable.slice(0, 10).join('|')}] c=[${chat.slice(0, 10).join('|')}] samp=[${names.slice(0, 10).join('|')}]`,
		)
	}, 3500)
}

let treeDumpCount = 0
function dumpTree(el: any, depth: number, maxDepth: number): void {
	if (treeDumpCount > 60 || depth > maxDepth || !el || typeof el !== 'object')
		return
	try {
		const typeName =
			typeof el.type === 'string'
				? el.type
				: (el.type?.name ??
					el.type?.displayName ??
					el.type?.render?.name ??
					'anon')
		const keys = Object.keys(el.props ?? {})
		console.log(`[CM-DUMP] tree d${depth}: ${typeName} keys=${keys.join(',')}`)
		treeDumpCount++
		const children = el.props?.children
		const kids = Array.isArray(children)
			? children
			: children != null
				? [children]
				: []
		for (const kid of kids) dumpTree(kid, depth + 1, maxDepth)
	} catch {}
}

function usernameNode(out: any, raw: any): AstNode {
	const fullName = displayName(out, raw)
	const name = truncateName(fullName)
	const tapId = raw?.author?.id ? String(raw.author.id) : undefined
	if (tapId) {
		if (name) usernameTapMap.set(name, tapId)
		if (fullName && fullName !== name) usernameTapMap.set(fullName, tapId)
		if (usernameTapMap.size > 200) usernameTapMap.clear()
	}
	return usernameTextNode(name)
}

function openProfile(userId: string): void {
	toast(`CM openProfile: ${userId}`)
	try {
		showUserProfile?.({ userId })
	} catch {}
}

function toast(text: string): void {
	try {
		ToastActionCreators.open('HV_CM', { text, duration: 3000 })
	} catch {}
}

let tapTargetLogs = 0
function logTapFound(kind: string, userId: string): void {
	if (tapTargetLogs < 20) {
		tapTargetLogs++
		toast(`CM tap: ${kind} ${userId}`)
	}
}

function firstString(value: any): string | undefined {
	if (typeof value === 'string' && value) return value
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = firstString(item)
			if (found) return found
		}
		return undefined
	}
	if (value && typeof value === 'object') return firstString(value.children)
	return undefined
}

function stringProps(props: Record<string, any>): string[] {
	const out: string[] = []
	for (const key of Object.keys(props)) {
		const value = props[key]
		if (typeof value === 'string' && value) out.push(value)
		const uri = Array.isArray(value)
			? value[0]?.uri
			: (value?.uri ?? value?.source?.uri)
		if (typeof uri === 'string' && uri) out.push(uri)
		const children = firstString(value)
		if (children) out.push(children)
	}
	return out
}

function findTapTarget(el: any): string | undefined {
	if (!el || typeof el !== 'object') return undefined
	const props = (el as any).props
	if (!props) return undefined

	for (const str of stringProps(props)) {
		const avatarId = avatarTapMap.get(str)
		if (avatarId) {
			logTapFound('avatar', avatarId)
			return avatarId
		}
	}
	for (const str of stringProps(props)) {
		const userId = usernameTapMap.get(str)
		if (userId) {
			logTapFound('username', userId)
			return userId
		}
	}
	return undefined
}

function wrapTaps(el: any, depth: number): any {
	if (depth > 20 || !el || typeof el !== 'object') return el

	const userId = findTapTarget(el)
	const Pressable = RN?.Pressable ?? RN?.TouchableOpacity
	if (userId && Pressable && typeof showUserProfile === 'function') {
		return createElement(Pressable, { onPress: () => openProfile(userId) }, el)
	}

	const props = (el as any).props
	if (props && props.children !== undefined) {
		const newChildren = wrapChildren(props.children, depth + 1)
		if (newChildren !== props.children) {
			return createElement(el.type, { ...props, children: newChildren }, el.key)
		}
	}
	return el
}

function wrapChildren(children: any, depth: number): any {
	if (Array.isArray(children)) {
		let changed = false
		const out = children.map(child => {
			const wrapped = wrapTaps(child, depth)
			if (wrapped !== child) changed = true
			return wrapped
		})
		return changed ? out : children
	}
	return wrapTaps(children, depth)
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

		cleanup(() => {
			avatarTapMap.clear()
			usernameTapMap.clear()
		})

		cleanup(
			getModules(
				withProps('showUserProfile'),
				exports => {
					const fn =
						(exports as any)?.showUserProfile ??
						(exports as any)?.default?.showUserProfile
					if (typeof fn === 'function') showUserProfile = fn
				},
				{ max: 5 },
			),
		)

		let chatFound = false
		cleanup(
			getModules(
				withProps('Pressable'),
				exports => {
					if (RN?.Pressable) return
					const candidate = (exports as any)?.default ?? (exports as any)
					if (candidate?.Pressable) RN = candidate
				},
				{ max: 5 },
			),
		)

		cleanup(
			getModules(
				withName('Chat'),
				exports => {
					const Chat =
						(exports as any)?.default ?? (exports as any)?.Chat ?? exports
					if (!Chat?.prototype) return
					chatFound = true
					ensureWritable(Chat.prototype, 'render')
					cleanup(
						afterLoose(Chat.prototype, 'render', (result: any) => {
							try {
								treeDumpCount = 0
								dumpTree(result, 0, 7)
								return wrapTaps(result, 0)
							} catch {
								return result
							}
						}),
					)
				},
				{ max: 5 },
			),
		)

		console.log(
			'[CompactMode] start: showUserProfile=',
			!!showUserProfile,
			'RN.Pressable=',
			!!RN?.Pressable,
			'ChatFound=',
			chatFound,
		)
		toast(
			`CM start: showUserProfile=${!!showUserProfile} RN=${!!RN?.Pressable} Chat=${chatFound}`,
		)

		setTimeout(() => {
			try {
				dumpModulesDiag()
			} catch {}
		}, 500)

		cleanup(
			getModules(withName('RowManager'), exports => install(exports, cleanup), {
				max: 5,
			}),
		)
	},

	SettingsComponent,
})
