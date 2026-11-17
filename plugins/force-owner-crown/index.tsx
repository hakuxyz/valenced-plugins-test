import {
	getAssetIdByName,
	getAssets,
	onAnyAssetRegistered,
} from '@valenced/assets'
import { Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after, before, instead } from '@valenced/patcher'
import { createElement } from 'react'
import { Image } from 'react-native'
import { CROWN_PNG } from './sprites'
import type { AnyFunction } from '@valenced/utils/types'

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
	hook: (this: any, args: any[], original: AnyFunction) => any,
) => () => void

const beforeLoose = before as unknown as LooseBefore
const afterLoose = after as unknown as LooseAfter
const insteadLoose = instead as unknown as LooseInstead

/**
 * Metro re-exports members as getters on the module namespace, and a plain
 * assignment cannot replace a getter. Rewrite such a member as a normal
 * writable property holding the same function, so the patcher can hook it
 * instead of failing silently.
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

interface User {
	id: string
	username?: string
	globalName?: string | null
}

interface Guild {
	id: string
	ownerId?: string
}

interface Member {
	nick?: string | null
}

interface RowProps {
	user?: User
	guildId?: string
	[key: string]: unknown
}

interface GuildStoreLike {
	getGuild(id: string): Guild | undefined
}

interface MemberStoreLike {
	getMember(guildId: string, userId: string): Member | undefined
}

interface SelectedGuildStoreLike {
	getGuildId(): string | undefined
}

interface UserStoreLike {
	getUser(id: string): User | undefined
}

interface Slot {
	children: unknown[]
	index: number
	owner: { props?: Record<string, unknown> } | null
}

const CROWN_ASSET_NAMES = [
	'CrownIcon',
	'OwnerCrownIcon',
	'GuildOwnerIcon',
	'ic_crown',
	'Crown',
]

/**
 * Asset registered at runtime whose name merely contains "crown". Only a
 * fallback: it may just as well be a boost crown or a badge.
 */
let registeredCrownId: number | undefined
/** Cached once a lookup succeeded, so rows do not rescan assets. */
let resolvedCrown: number | { uri: string } | undefined
const crownFallback: { uri: string } = {
	uri: `data:image/png;base64,${CROWN_PNG}`,
}

function storeByName(name: string): Record<string, AnyFunction> | undefined {
	try {
		return (Stores as unknown as Record<string, Record<string, AnyFunction>>)[
			name
		]
	} catch {
		return undefined
	}
}

function resolveCrownSource(): number | { uri: string } {
	if (resolvedCrown) return resolvedCrown

	// Exact names first. A runtime "crown" match may be an unrelated icon,
	// and until now it preempted this lookup and could render the wrong
	// glyph instead of the owner crown.
	for (const name of CROWN_ASSET_NAMES) {
		try {
			const id = getAssetIdByName(name)
			if (typeof id === 'number' && id > 0) {
				resolvedCrown = id
				return id
			}
		} catch {}
	}

	if (typeof registeredCrownId === 'number') {
		resolvedCrown = registeredCrownId
		return registeredCrownId
	}

	try {
		for (const asset of getAssets()) {
			if (/crown/i.test(asset.name ?? '')) {
				resolvedCrown = asset.id
				return asset.id
			}
		}
	} catch {}

	resolvedCrown = crownFallback
	return crownFallback
}

/** Numeric asset id of the crown, once one resolved to an asset. */
function crownAssetId(): number | undefined {
	resolveCrownSource()
	return typeof resolvedCrown === 'number' ? resolvedCrown : undefined
}

function nodeTypeName(node: any): string {
	const type = node?.type
	if (typeof type === 'function') return type.displayName ?? type.name ?? ''
	if (type && typeof type === 'object') {
		return (
			type.displayName ??
			type.name ??
			type.type?.displayName ??
			type.type?.name ??
			''
		)
	}
	return ''
}

function walk(node: any, visit: (node: any) => boolean): boolean {
	if (node == null) return false
	if (Array.isArray(node)) {
		for (const child of node) if (walk(child, visit)) return true
		return false
	}
	if (typeof node !== 'object') return false
	if (visit(node)) return true
	const children = node.props?.children
	if (children !== undefined && children !== null) return walk(children, visit)
	return false
}

function isCrownNode(node: any): boolean {
	const name = nodeTypeName(node)
	if (name && /crown/i.test(name)) return true

	const props = node?.props
	if (!props) return false

	const label =
		props.accessibilityLabel ?? props['aria-label'] ?? props.alt ?? props.hint
	if (typeof label === 'string' && /crown|server owner/i.test(label))
		return true

	const source = props.source
	const crownId = crownAssetId()
	if (
		typeof source === 'number' &&
		typeof crownId === 'number' &&
		source === crownId
	) {
		return true
	}

	return false
}

function containsName(node: any, names: string[]): boolean {
	if (typeof node === 'string')
		return names.some(n => n.length > 0 && node.includes(n))
	if (node == null) return false
	if (Array.isArray(node)) return node.some(child => containsName(child, names))
	if (typeof node === 'object') return containsName(node.props?.children, names)
	return false
}

function collectSlots(
	node: any,
	owner: Slot['owner'],
	names: string[],
	out: Slot[],
): void {
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			const child = node[i]
			if (!child || typeof child !== 'object') continue
			collectSlots(child.props?.children, child, names, out)
			if (containsName(child, names))
				out.push({ children: node, index: i, owner })
		}
		return
	}
	if (node && typeof node === 'object') {
		collectSlots(node.props?.children, node, names, out)
	}
}

function flattenStyle(style: any, out: any[] = []): any[] {
	if (Array.isArray(style)) {
		for (const entry of style) flattenStyle(entry, out)
	} else if (style != null) {
		out.push(style)
	}
	return out
}

function isRowContainer(slot: Slot): boolean {
	return isRowOwner(slot.owner)
}

function isRowOwner(owner: Slot['owner']): boolean {
	for (const entry of flattenStyle(owner?.props?.style)) {
		if (entry && typeof entry === 'object' && 'flexDirection' in entry) {
			return (entry as { flexDirection?: unknown }).flexDirection === 'row'
		}
	}
	return false
}

/**
 * Whether the slot owner renders text. An image is not a valid child of a
 * `Text`, so such a slot is never used for the crown.
 */
function isTextOwner(owner: Slot['owner']): boolean {
	const name = nodeTypeName(owner)
	if (name === 'Text' || name === 'RCTText') return true
	const type = (owner as any)?.type
	return type === 'Text' || type === 'RCTText'
}

/** Row containers in the tree, deepest first, used when no name was found. */
function collectRows(node: any, owner: Slot['owner'], out: Slot[]): void {
	if (Array.isArray(node)) {
		for (const child of node) {
			if (!child || typeof child !== 'object') continue
			collectRows(child.props?.children, child, out)
		}
		if (owner && isRowOwner(owner)) {
			out.push({ children: node, index: node.length - 1, owner })
		}
		return
	}
	if (node && typeof node === 'object') {
		collectRows(node.props?.children, node, out)
	}
}

function guildStore(): GuildStoreLike | undefined {
	return storeByName('GuildStore') as unknown as GuildStoreLike | undefined
}

function memberStore(): MemberStoreLike | undefined {
	return storeByName('GuildMemberStore') as unknown as
		| MemberStoreLike
		| undefined
}

function selectedGuildStore(): SelectedGuildStoreLike | undefined {
	return storeByName('SelectedGuildStore') as unknown as
		| SelectedGuildStoreLike
		| undefined
}

function userStore(): UserStoreLike | undefined {
	return storeByName('UserStore') as unknown as UserStoreLike | undefined
}

/**
 * The user a row renders. Not every build puts `user` on the row props, so
 * the member object and a plain `userId` are tried as well.
 */
function resolveUser(props: RowProps | undefined): User | undefined {
	if (!props) return undefined

	const direct = props.user
	if (direct && typeof direct.id === 'string' && direct.id) return direct

	const fromMember = (props as any).member?.user
	if (fromMember && typeof fromMember.id === 'string' && fromMember.id) {
		return fromMember as User
	}

	const id = (props as any).userId
	if (typeof id === 'string' && id) {
		try {
			const found = userStore()?.getUser?.(id)
			if (found && typeof found.id === 'string' && found.id) return found
		} catch {}
	}

	return undefined
}

function currentGuildId(props: RowProps): string | undefined {
	const p = props as any
	if (typeof p?.guildId === 'string' && p.guildId) return p.guildId
	if (typeof p?.guild?.id === 'string' && p.guild.id) return p.guild.id
	if (typeof p?.channel?.guild_id === 'string' && p.channel.guild_id) {
		return p.channel.guild_id
	}
	try {
		return selectedGuildStore()?.getGuildId?.()
	} catch {
		return undefined
	}
}

function candidateNames(user: User, guildId: string): string[] {
	const names: string[] = []
	try {
		const member = memberStore()?.getMember?.(guildId, user.id)
		if (typeof member?.nick === 'string' && member.nick) names.push(member.nick)
	} catch {}
	if (typeof user.globalName === 'string' && user.globalName) {
		names.push(user.globalName)
	}
	if (typeof user.username === 'string' && user.username)
		names.push(user.username)
	return names
}

function decorate(result: any, props: RowProps | undefined): any {
	const guildId = currentGuildId(props ?? {})
	if (!guildId) return result

	let guild: Guild | undefined
	try {
		guild = guildStore()?.getGuild?.(guildId)
	} catch {
		guild = undefined
	}
	if (!guild?.ownerId) return result

	const user = resolveUser(props)
	const knownOwner = !!user
	let names: string[]
	if (user) {
		// The row tells us who it renders, so only the owner may match.
		if (user.id !== guild.ownerId) return result
		names = candidateNames(user, guildId)
	} else {
		// Without a user on the props the rendered name is the only proof
		// that this row is the owner. `collectSlots` matches on it as well,
		// so other rows can never receive a crown.
		let owner: User | undefined
		try {
			owner = userStore()?.getUser?.(guild.ownerId)
		} catch {
			owner = undefined
		}
		if (!owner) return result
		names = candidateNames(owner, guildId)
	}
	if (names.length === 0) return result

	// Cheap gate for the fallback path: a row that does not show one of the
	// owner's names cannot be the owner row.
	if (!knownOwner && !containsName(result, names)) return result

	// Discord already rendered a crown somewhere in this row.
	resolveCrownSource()
	if (walk(result, isCrownNode)) return result

	// Name based slots first, so the crown lands next to the username. Text
	// owners are dropped because an image is not a valid child of a `Text`.
	let slots: Slot[] = []
	collectSlots(result, null, names, slots)
	slots = slots.filter(slot => !isTextOwner(slot.owner))
	// The name agnostic row fallback is only safe when the row is known to
	// be the owner; otherwise it would decorate every row in the list.
	if (slots.length === 0 && knownOwner) collectRows(result, null, slots)
	if (slots.length === 0) return result

	const slot = slots.find(isRowContainer) ?? slots[0]

	slot.children.splice(
		slot.index + 1,
		0,
		createElement(Image, {
			source: resolveCrownSource(),
			style: { width: 14, height: 14, marginLeft: 4 },
			resizeMode: 'contain',
			accessibilityLabel: 'Server Owner',
		}),
	)

	return result
}

/** Captures the props of a render call and decorates its element tree. */
function patchWithPropsCapture(
	parent: Record<string, AnyFunction>,
	key: string,
	cleanup: Cleanup,
) {
	let pending: RowProps | undefined
	cleanup(
		beforeLoose(parent, key, (args: any[]) => {
			pending = args?.[0] as RowProps
			// Valenced replaces the call arguments with the return value.
			return args
		}),
	)
	cleanup(
		afterLoose(parent, key, (result: any) => {
			const props = pending
			pending = undefined
			if (!props) return result
			try {
				return decorate(result, props)
			} catch {
				return result
			}
		}),
	)
}

/**
 * Attaches the crown hook to a component in whatever shape Discord wrapped it
 * in: plain function, class, forwardRef or memo.
 */
function patchRenderable(
	target: any,
	parent: Record<string, AnyFunction>,
	key: string,
	cleanup: Cleanup,
	seen: Set<unknown>,
) {
	if (!target || seen.has(target)) return
	seen.add(target)

	if (typeof target === 'function') {
		// Class component: render() has no props argument, read them from the instance.
		if (typeof target.prototype?.render === 'function') {
			if (seen.has(target.prototype)) return
			seen.add(target.prototype)
			cleanup(
				insteadLoose(
					target.prototype as unknown as Record<string, AnyFunction>,
					'render',
					function (this: any, args: any[], original: AnyFunction) {
						const result = original.apply(this, args)
						try {
							return decorate(result, this?.props as RowProps)
						} catch {
							return result
						}
					},
				),
			)
			return
		}
		// Plain function component.
		patchWithPropsCapture(parent, key, cleanup)
		return
	}

	if (target && typeof target === 'object') {
		// forwardRef wrapper.
		if (typeof target.render === 'function') {
			patchWithPropsCapture(
				target as unknown as Record<string, AnyFunction>,
				'render',
				cleanup,
			)
			return
		}
		// memo wrapper: hook the inner type through the memo object.
		if (target.type) {
			patchRenderable(
				target.type,
				target as Record<string, AnyFunction>,
				'type',
				cleanup,
				seen,
			)
		}
	}
}

function installRowPatch(mod: unknown, cleanup: Cleanup, seen: Set<unknown>) {
	const m = mod as Record<string, any> | null
	const row = m?.GuildMemberRow
	if (!row) return
	ensureWritable(m, 'GuildMemberRow')
	patchRenderable(
		row,
		m as Record<string, AnyFunction>,
		'GuildMemberRow',
		cleanup,
		seen,
	)
}

export default plugin({
	start({ cleanup }) {
		const seen = new Set<unknown>()

		cleanup(
			getModules(withProps('GuildMemberRow'), (mod: unknown) => {
				try {
					installRowPatch(mod, cleanup, seen)
				} catch {}
			}),
		)

		cleanup(
			onAnyAssetRegistered(asset => {
				if (
					registeredCrownId === undefined &&
					/crown/i.test((asset as { name?: string })?.name ?? '')
				) {
					registeredCrownId = (asset as { id: number }).id
				}
			}),
		)
	},
})
