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

let crownAssetId: number | undefined
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
	if (typeof crownAssetId === 'number') return crownAssetId

	for (const name of CROWN_ASSET_NAMES) {
		try {
			const id = getAssetIdByName(name)
			if (typeof id === 'number' && id > 0) {
				crownAssetId = id
				return id
			}
		} catch {}
	}

	try {
		for (const asset of getAssets()) {
			if (/crown/i.test(asset.name ?? '')) {
				crownAssetId = asset.id
				return asset.id
			}
		}
	} catch {}

	return crownFallback
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
	if (
		typeof source === 'number' &&
		typeof crownAssetId === 'number' &&
		source === crownAssetId
	) {
		return true
	}

	return false
}

function isImageNode(node: any): boolean {
	const name = nodeTypeName(node)
	return name === 'Image' || name === 'RCTImage' || name === 'ImageBackground'
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
	for (const entry of flattenStyle(slot.owner?.props?.style)) {
		if (entry && typeof entry === 'object' && 'flexDirection' in entry) {
			return (entry as { flexDirection?: unknown }).flexDirection === 'row'
		}
	}
	return false
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

function currentGuildId(props: RowProps): string | undefined {
	if (typeof props.guildId === 'string' && props.guildId) return props.guildId
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
	const user = props?.user
	if (!user?.id) return result

	const guildId = currentGuildId(props ?? {})
	if (!guildId) return result

	let guild: Guild | undefined
	try {
		guild = guildStore()?.getGuild?.(guildId)
	} catch {
		guild = undefined
	}
	if (!guild || guild.ownerId !== user.id) return result

	// Discord already rendered a crown somewhere in this row.
	if (walk(result, isCrownNode)) return result

	const names = candidateNames(user, guildId)
	if (names.length === 0) return result

	const slots: Slot[] = []
	collectSlots(result, null, names, slots)
	if (slots.length === 0) return result

	const deepest = slots[0]
	const slot = slots.find(isRowContainer) ?? deepest

	if (slot === deepest) {
		const siblings = deepest.children.filter(
			(_, i) => i !== deepest.index,
		) as any[]
		if (siblings.some(child => walk(child, isImageNode))) return result
	}

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

function installRowPatch(mod: unknown, cleanup: Cleanup, seen: Set<unknown>) {
	const m = mod as Record<string, any> | null
	const row = m?.GuildMemberRow
	if (!row) return

	const finish = (parent: Record<string, AnyFunction>, key: string) => {
		if (seen.has(parent)) return
		seen.add(parent)

		let pending: RowProps | undefined
		cleanup(
			beforeLoose(parent, key, (args: any[]) => {
				pending = args?.[0] as RowProps
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

	// Class component: render() has no props argument, read them from the instance.
	if (
		typeof row === 'function' &&
		typeof row.prototype?.render === 'function'
	) {
		if (seen.has(row.prototype)) return
		seen.add(row.prototype)
		cleanup(
			insteadLoose(
				row.prototype as Record<string, AnyFunction>,
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

	if (typeof row === 'function') {
		finish(m as Record<string, AnyFunction>, 'GuildMemberRow')
		return
	}

	if (row && typeof row === 'object' && typeof row.type === 'function') {
		finish(row as Record<string, AnyFunction>, 'type')
		return
	}

	if (row && typeof row === 'object' && typeof row.render === 'function') {
		finish(row as Record<string, AnyFunction>, 'render')
	}
}

export default plugin({
	start({ cleanup }) {
		const seen = new Set<unknown>()

		cleanup(
			getModules(
				withProps('GuildMemberRow'),
				(mod: unknown) => {
					try {
						installRowPatch(mod, cleanup, seen)
					} catch {}
				},
				{ returnNamespace: true },
			),
		)

		cleanup(
			onAnyAssetRegistered(asset => {
				if (
					typeof crownAssetId !== 'number' &&
					/crown/i.test((asset as { name?: string })?.name ?? '')
				) {
					crownAssetId = (asset as { id: number }).id
				}
			}),
		)
	},
})
