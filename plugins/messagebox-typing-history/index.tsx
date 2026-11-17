import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import { createElement } from 'react'
import { attachGestures, setGestureChannelGetter } from './gestures'
import TypingHistoryPill from './pill'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import {
	channelFor,
	currentSettings,
	record,
	seed,
	setApplier,
	setSettingsGetter,
} from './state'
import type { AnyFunction } from '@valenced/utils/types'
import type { Settings } from './shared'

type Cleanup = (...fns: Array<() => unknown>) => void

type LooseAfter = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (result: any) => any,
) => () => void

const afterLoose = after as unknown as LooseAfter

const PILL_KEY = 'hakuxyz-typing-history-pill'

/** Components already patched, shared across lifecycle calls. */
const seen = new Set<unknown>()

/** Input props we already wrapped onChangeText on, to avoid double wrapping. */
const wrapped = new WeakSet<object>()

/** Latest unwrapped onChangeText, used to push history back into the box. */
let latestApply: ((text: string) => void) | undefined
/** Channel the latest render belongs to. */
let latestChannel = ''

function typeName(node: any): string {
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

function isTextInput(node: any): boolean {
	if (!node || typeof node !== 'object') return false
	if (typeof node.props?.onChangeText !== 'function') return false
	const name = typeName(node)
	return name === 'ChatInput' || name === 'TextInput'
}

function isRowView(node: any): boolean {
	return typeName(node) === 'View' || typeName(node) === 'RCTView'
}

interface Located {
	input: any
	/** Deepest ancestor holding an array of children, where the pill goes. */
	row: any
	/** Deepest View ancestor, which owns the responder gesture handlers. */
	host: any
}

/**
 * Walks the render result to the message box input while remembering the
 * ancestors, so both the row and the responder host can be resolved.
 */
function locate(node: any, ancestors: any[], depth = 0): Located | undefined {
	if (node == null || depth > 40) return undefined

	if (Array.isArray(node)) {
		for (const child of node) {
			const found = locate(child, ancestors, depth + 1)
			if (found) return found
		}
		return undefined
	}

	if (typeof node !== 'object') return undefined

	if (isTextInput(node)) {
		let row: any
		let host: any
		for (let i = ancestors.length - 1; i >= 0; i--) {
			const ancestor = ancestors[i]
			if (!row && Array.isArray(ancestor?.props?.children)) row = ancestor
			if (!host && isRowView(ancestor)) host = ancestor
		}
		return { input: node, row, host: host ?? row }
	}

	const children = node.props?.children
	if (children == null) return undefined

	ancestors.push(node)
	const found = locate(children, ancestors, depth + 1)
	ancestors.pop()
	return found
}

/** Injects the pill, wraps onChangeText and wires up the gestures. */
function decorate(result: any): any {
	try {
		if (result == null || typeof result !== 'object') return result

		const located = locate(result, [])
		if (!located) return result

		const settings = currentSettings()
		const input = located.input
		const ip = input.props

		const explicit =
			typeof ip.channelId === 'string' && ip.channelId
				? ip.channelId
				: undefined
		const channelId = channelFor(explicit)
		latestChannel = channelId

		seed(channelId, ip.value ?? ip.defaultValue)

		if (typeof ip.onChangeText === 'function' && !wrapped.has(ip)) {
			wrapped.add(ip)
			const original = ip.onChangeText as (text: string) => void
			latestApply = original
			ip.onChangeText = (text: string) => {
				record(channelId, text)
				original(text)
			}
		}

		setApplier(text => {
			try {
				latestApply?.(text)
			} catch {}
		})

		const row = located.row
		if (row && typeof row.props === 'object') {
			try {
				const children = row.props.children
				const list = Array.isArray(children)
					? children
					: children != null
						? [children]
						: []
				const rest = list.filter(
					(child: any) => child?.type !== TypingHistoryPill,
				)
				row.props.children = settings.buttons
					? [
							createElement(TypingHistoryPill, {
								key: PILL_KEY,
								channelId,
							}),
							...rest,
						]
					: rest
			} catch {}
		}

		const host = located.host
		if (settings.gestures && host && typeof host.props === 'object') {
			try {
				attachGestures(host.props)
			} catch {}
		}

		return result
	} catch {
		return result
	}
}

function install(
	target: any,
	ns: Record<string, AnyFunction>,
	cleanup: Cleanup,
) {
	const name = 'ChatInput'
	if (seen.has(target)) return
	seen.add(target)

	// Class component: render() takes no props, the tree holds them.
	if (
		typeof target === 'function' &&
		typeof target.prototype?.render === 'function'
	) {
		seen.add(target.prototype)
		cleanup(
			afterLoose(
				target.prototype as unknown as Record<string, AnyFunction>,
				'render',
				decorate,
			),
		)
		return
	}

	// Plain function component.
	if (typeof target === 'function') {
		if (seen.has(ns)) return
		seen.add(ns)
		cleanup(afterLoose(ns, name, decorate))
		return
	}

	// Memo or forwardRef wrapper.
	if (target && typeof target === 'object') {
		if (typeof target.render === 'function') {
			cleanup(
				afterLoose(
					target as unknown as Record<string, AnyFunction>,
					'render',
					decorate,
				),
			)
			return
		}
		if (target.type) {
			install(target.type, target as Record<string, AnyFunction>, cleanup)
		}
	}
}

function scan(namespace: unknown, cleanup: Cleanup) {
	try {
		const ns = namespace as Record<string, any> | null
		if (!ns || typeof ns !== 'object') return
		const target = ns.ChatInput
		if (!target) return
		install(target, ns, cleanup)
	} catch {}
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	init({ cleanup, jsonStorage }) {
		setSettingsGetter(() => ({
			...DefaultSettings,
			...(jsonStorage.cache ?? {}),
		}))
		setGestureChannelGetter(() => latestChannel || channelFor())
		cleanup(
			getModules(withProps('ChatInput'), ns => scan(ns, cleanup), {
				returnNamespace: true,
			}),
		)
	},
	start({ cleanup, jsonStorage }) {
		setSettingsGetter(() => ({
			...DefaultSettings,
			...(jsonStorage.cache ?? {}),
		}))
		setGestureChannelGetter(() => latestChannel || channelFor())
		cleanup(
			getModules(withProps('ChatInput'), ns => scan(ns, cleanup), {
				returnNamespace: true,
			}),
		)
	},
	SettingsComponent,
})
