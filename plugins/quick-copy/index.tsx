import { ToastActionCreators } from '@valenced/discord/actions'
import { Stores } from '@valenced/discord/flux'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after, before } from '@valenced/patcher'
import SettingsComponent from './settings'
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

const beforeLoose = before as unknown as LooseBefore
const afterLoose = after as unknown as LooseAfter

interface CommandOption {
	name: string
	displayName: string
	description: string
	displayDescription: string
	untranslatedName?: string
	untranslatedDescription?: string
	type: number
	required?: boolean
}

interface Command {
	id: string
	applicationId: string
	type: number
	inputType: number
	name: string
	displayName: string
	untranslatedName: string
	description: string
	displayDescription: string
	untranslatedDescription: string
	options: CommandOption[]
	execute: (args: any, ctx: any) => unknown
}

const registered: Command[] = []

function store(name: string): any {
	try {
		return (Stores as unknown as Record<string, any>)[name]
	} catch {
		return undefined
	}
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

function toast(
	text: string,
	variant: 'success' | 'critical' = 'success',
): void {
	try {
		ToastActionCreators.open(`QUICK_COPY_${Date.now()}_${Math.random()}`, {
			text,
			variant,
		})
	} catch {}
}

function copyValue(value: unknown, label: string): void {
	if (typeof value !== 'string' || value.length === 0) {
		toast(`Could not resolve ${label}.`, 'critical')
		return
	}

	try {
		Clipboard.setString(value)
		toast(`Copied ${label}.`)
	} catch {
		toast('Clipboard is unavailable.', 'critical')
	}
}

function optionValue(args: any, name: string): unknown {
	if (!args) return undefined

	if (args instanceof Map) {
		const value = args.get(name)
		return value && typeof value === 'object' && 'value' in value
			? value.value
			: value
	}
	if (Array.isArray(args)) {
		const option = args.find(
			item => item?.name === name || item?.displayName === name,
		)
		return option?.value
	}
	if (typeof args === 'object') {
		const value = args[name]
		return value && typeof value === 'object' && 'value' in value
			? value.value
			: value
	}
	return undefined
}

function resolveUser(args: any): any {
	const UserStore = store('UserStore')
	const value = optionValue(args, 'user')

	if (value == null || value === '') {
		try {
			return UserStore?.getCurrentUser?.() ?? null
		} catch {
			return null
		}
	}

	let idValue: unknown = value
	if (typeof value === 'object') {
		const candidate = value as { id?: unknown; userId?: unknown }
		idValue = candidate.id ?? candidate.userId
	}
	const id = typeof idValue === 'string' ? idValue : String(idValue ?? '')
	const cleaned = id.trim().replace(/^<@!?/, '').replace(/>$/, '')
	if (!cleaned) return null

	try {
		return UserStore?.getUser?.(cleaned) ?? null
	} catch {
		return null
	}
}

function avatarUrl(user: any): string | undefined {
	if (!user || typeof user !== 'object') return undefined

	if (user.avatar == null || user.avatar === '') {
		const discriminator = Number(user.discriminator)
		const fallback = Number.isFinite(discriminator)
			? Math.abs(discriminator) % 5
			: 0
		return `https://cdn.discordapp.com/embed/avatars/${fallback}.png`
	}

	const hash = String(user.avatar)
	const extension = hash.startsWith('a_') ? 'gif' : 'png'
	return `https://cdn.discordapp.com/avatars/${user.id}/${hash}.${extension}?size=512`
}

function channelId(ctx: any): string | undefined {
	if (typeof ctx?.channelId === 'string' && ctx.channelId) return ctx.channelId
	if (typeof ctx?.channel?.id === 'string' && ctx.channel.id)
		return ctx.channel.id

	try {
		const id = store('SelectedChannelStore')?.getChannelId?.()
		return typeof id === 'string' && id ? id : undefined
	} catch {
		return undefined
	}
}

function executeUid(args: any): void {
	try {
		copyValue(resolveUser(args)?.id, 'user ID')
	} catch {
		toast('Failed to copy user ID.', 'critical')
	}
}

function executeAvatar(args: any): void {
	try {
		copyValue(avatarUrl(resolveUser(args)), 'avatar URL')
	} catch {
		toast('Failed to copy avatar URL.', 'critical')
	}
}

function executeChannelId(_args: any, ctx: any): void {
	try {
		copyValue(channelId(ctx), 'channel ID')
	} catch {
		toast('Failed to copy channel ID.', 'critical')
	}
}

function createCommand(
	id: string,
	name: string,
	description: string,
	options: CommandOption[],
	execute: (args: any, ctx: any) => unknown,
): Command {
	return {
		id,
		applicationId: '-1',
		type: 1,
		inputType: 1,
		name,
		displayName: name,
		untranslatedName: name,
		description,
		displayDescription: description,
		untranslatedDescription: description,
		options,
		execute,
	}
}

function userOption(): CommandOption {
	const description = 'User id or mention. Leave empty for yourself.'
	return {
		name: 'user',
		displayName: 'user',
		untranslatedName: 'user',
		description,
		displayDescription: description,
		untranslatedDescription: description,
		type: 3,
		required: false,
	}
}

function createCommands(): Command[] {
	return [
		createCommand(
			'-910001',
			'uid',
			'Copy a user id to your clipboard.',
			[userOption()],
			executeUid,
		),
		createCommand(
			'-910002',
			'avatar',
			'Copy an avatar URL to your clipboard.',
			[userOption()],
			executeAvatar,
		),
		createCommand(
			'-910003',
			'channelid',
			'Copy the current channel id to your clipboard.',
			[],
			executeChannelId,
		),
	]
}

const patched = new Set<AnyFunction>()

function install(mod: any, cleanup: Cleanup): void {
	const original = mod?.getBuiltInCommands as AnyFunction | undefined
	if (!original || patched.has(original)) return

	try {
		ensureWritable(mod, 'getBuiltInCommands')
		patched.add(original)

		let lastArgs: any[] = []
		const unBefore = beforeLoose(mod, 'getBuiltInCommands', (args: any[]) => {
			lastArgs = args
			return args
		})
		const unAfter = afterLoose(mod, 'getBuiltInCommands', (result: any) => {
			const args = lastArgs
			lastArgs = []
			if (!Array.isArray(result)) return result
			if (args?.[0] !== 1 && args?.[0] !== undefined) return result

			const existing = new Set(
				result.map((command: any) => command?.name).filter(Boolean),
			)
			const extra = registered.filter(command => !existing.has(command.name))
			return extra.length > 0 ? [...result, ...extra] : result
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

export default plugin({
	start({ cleanup }) {
		registered.push(...createCommands())
		cleanup(() => {
			registered.length = 0
		})

		cleanup(
			getModules(
				withProps('getBuiltInCommands'),
				mod => install(mod, cleanup),
				{ max: 5 },
			),
		)
	},

	SettingsComponent,
})
