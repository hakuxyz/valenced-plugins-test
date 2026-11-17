import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { after, before } from '@valenced/patcher'
import { findInTree } from '@valenced/utils/tree'
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

type LooseBefore = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (args: any[]) => any,
) => () => void

const afterLoose = after as unknown as LooseAfter
const beforeLoose = before as unknown as LooseBefore

const PILL_KEY = 'hakuxyz-typing-history-pill'
const GUARD_NAME = 'ChatInputGuardWrapper'

/** Components already patched, shared across lifecycle calls. */
const seen = new Set<unknown>()

/** Input instances whose handler we already observe. */
const wired = new WeakSet<object>()

/** Cleanup registry of the running lifecycle, used while rendering. */
let register: Cleanup | undefined
/** Latest input instance, the preferred writer for history. */
let latestInstance: any
/** Latest input props, used to resolve the live channel. */
let latestInputProps: any
/** Channel the latest render belongs to. */
let latestChannel = ''
/**
 * Set once the guard wrapper render found a place for the pill, so the
 * `ChatInput` fallback does not inject a second copy of it.
 */
let guardActive = false
/** Set by the last `decorate` call when it found a place for the pill. */
let injected = false

/** `findInTree` only narrows for type guards, so wrap every search. */
function findNode(tree: any, predicate: (node: any) => boolean): any {
	return findInTree(tree, (node: any): node is Record<string, any> => {
		try {
			return predicate(node)
		} catch {
			return false
		}
	}) as any
}

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

/**
 * Structural match for the message box input. Minified builds drop
 * `displayName`, so the shape of the props is what identifies it.
 */
function isInputNode(node: any): boolean {
	if (!node || typeof node !== 'object') return false
	const props = node.props
	if (!props || typeof props !== 'object') return false
	if (typeof props.onChangeText !== 'function') return false
	const name = typeName(node)
	return name !== 'View' && name !== 'RCTView' && name !== 'Text'
}

function isViewLike(node: any): boolean {
	const name = typeName(node)
	if (name === 'View' || name === 'RCTView') return true
	const props = node?.props
	if (!props || typeof props !== 'object') return false
	return (
		typeof props.onStartShouldSetResponder === 'function' ||
		typeof props.onResponderGrant === 'function'
	)
}

function refTarget(ref: any): any {
	if (ref == null) return undefined
	if (typeof ref === 'object' && 'current' in ref)
		return ref.current ?? undefined
	return ref
}

function channelFrom(...candidates: any[]): string | undefined {
	for (const candidate of candidates) {
		if (typeof candidate === 'string' && candidate) return candidate
	}
	return undefined
}

/** Channel of the box we last rendered, used while recording keystrokes. */
function liveChannel(): string {
	return channelFor(
		channelFrom(
			latestInputProps?.channelId,
			latestInstance?.props?.channelId,
			latestInstance?.props?.channel?.id,
		),
	)
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

	if (isInputNode(node)) {
		let row: any
		let host: any
		for (let i = ancestors.length - 1; i >= 0; i--) {
			const ancestor = ancestors[i]
			if (!row && Array.isArray(ancestor?.props?.children)) row = ancestor
			if (!host && isViewLike(ancestor)) host = ancestor
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

/**
 * Injects the pill, observes typing and wires up the gestures.
 *
 * The tree is only touched when it can be proven to be the message box:
 * either the input element itself or the `chatInputRef` holder must be
 * present. Anything else is returned untouched, so a wrong module match
 * can never break an unrelated screen.
 */
function decorate(result: any, allowInject: boolean): any {
	injected = false
	try {
		if (result == null || typeof result !== 'object') return result
		const isElement =
			Array.isArray(result) ||
			result.$$typeof != null ||
			(result.props !== undefined && result.type !== undefined)
		if (!isElement) return result

		const settings = currentSettings()
		const located = locate(result, [])
		const refHolder = findNode(
			result,
			node => node?.props?.chatInputRef != null,
		)
		// Not the message box: never mutate or wire anything.
		if (!located && !refHolder) return result

		const inputProps = located?.input?.props
		if (inputProps) latestInputProps = inputProps

		const instance =
			refTarget(refHolder?.props?.chatInputRef) ??
			refTarget(inputProps?.ref) ??
			refTarget(inputProps?.inputRef) ??
			refTarget(inputProps?.textInputRef)
		if (instance) latestInstance = instance

		const channelId = channelFor(
			channelFrom(
				inputProps?.channelId,
				instance?.props?.channelId,
				instance?.props?.channel?.id,
			),
		)
		latestChannel = channelId

		seed(
			channelId,
			inputProps?.value ?? inputProps?.defaultValue ?? instance?.state?.text,
		)

		// Reading keystrokes through the instance handler survives minification.
		if (
			instance &&
			typeof instance === 'object' &&
			!wired.has(instance) &&
			typeof instance.handleTextChanged === 'function'
		) {
			try {
				const unpatch = beforeLoose(
					instance,
					'handleTextChanged',
					(args: any[]) => {
						try {
							const text = args?.[0]
							if (typeof text === 'string') record(liveChannel(), text)
						} catch {}
						// Valenced replaces the call arguments with the return value.
						return args
					},
				)
				wired.add(instance)
				register?.(() => {
					wired.delete(instance)
					unpatch()
				})
			} catch {}
		}

		setApplier(text => {
			try {
				const target = latestInstance
				if (target && typeof target.handleTextChanged === 'function') {
					target.handleTextChanged(text)
				}
			} catch {}
		})

		if (allowInject) {
			// Prefer the component root once `chatInputRef` proved this is the
			// message box (the target the known plugins inject into), then the
			// row that directly holds the input. Only array children are ever
			// touched, and the pill is appended so existing `children[0]`
			// consumers keep working.
			const row =
				refHolder && Array.isArray(result?.props?.children)
					? result
					: located?.row
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
								...rest,
								createElement(TypingHistoryPill, {
									key: PILL_KEY,
									channelId,
								}),
							]
						: rest
					injected = true
				} catch {}
			}

			const host = located?.host ?? (refHolder ? result : undefined)
			if (settings.gestures && host && typeof host.props === 'object') {
				try {
					attachGestures(host.props)
				} catch {}
			}
		}

		return result
	} catch {
		return result
	}
}

function install(
	target: any,
	ns: Record<string, AnyFunction>,
	key: string,
	cleanup: Cleanup,
) {
	if (!target || seen.has(target)) return
	seen.add(target)

	// Class component: render() takes no props, the tree holds them.
	if (
		typeof target === 'function' &&
		typeof target.prototype?.render === 'function'
	) {
		seen.add(target.prototype)
		const proto = target.prototype as unknown as Record<string, AnyFunction>
		const unpatch = afterLoose(proto, 'render', result =>
			decorate(result, !guardActive),
		)
		cleanup(() => {
			unpatch()
			seen.delete(target)
			seen.delete(target.prototype)
		})
		return
	}

	// Plain function component: patch it on whatever holds the reference.
	if (typeof target === 'function') {
		const unpatch = afterLoose(ns, key, result =>
			decorate(result, !guardActive),
		)
		cleanup(() => {
			unpatch()
			seen.delete(target)
		})
		return
	}

	// forwardRef wrapper.
	if (target && typeof target === 'object') {
		if (typeof target.render === 'function') {
			const ref = target as unknown as Record<string, AnyFunction>
			const unpatch = afterLoose(ref, 'render', result =>
				decorate(result, !guardActive),
			)
			cleanup(() => {
				unpatch()
				seen.delete(target)
			})
			return
		}
		// memo wrapper: patch the inner type through the memo object.
		if (target.type) {
			seen.delete(target)
			install(
				target.type,
				target as Record<string, AnyFunction>,
				'type',
				cleanup,
			)
		}
	}
}

function scan(namespace: unknown, cleanup: Cleanup) {
	try {
		const ns = namespace as Record<string, any> | null
		if (!ns || typeof ns !== 'object') return
		const target = ns.ChatInput
		if (!target) return
		install(target, ns, 'ChatInput', cleanup)
	} catch {}
}

/**
 * Patches the guard wrapper around the message box. This is the reliable
 * entry point: its render result carries `chatInputRef`, which exposes the
 * input instance regardless of how the inner components are minified.
 */
function scanGuard(namespace: unknown, cleanup: Cleanup) {
	try {
		const ns = namespace as Record<string, any> | null
		if (!ns || typeof ns !== 'object') return

		let key = 'default'
		let target = ns.default
		if (typeof target !== 'function') {
			target = undefined
			for (const candidate of Object.keys(ns)) {
				const value = ns[candidate]
				if (typeof value === 'function' && (value as any).name === GUARD_NAME) {
					key = candidate
					target = value
					break
				}
			}
		}
		if (!target || seen.has(target)) return
		seen.add(target)

		const unpatch = afterLoose(ns, key, ret => {
			const decorated = decorate(ret, true)
			if (injected) guardActive = true
			return decorated
		})
		cleanup(() => {
			unpatch()
			seen.delete(target)
			guardActive = false
		})
	} catch {}
}

function bootstrap(cleanup: Cleanup, jsonStorage: any) {
	register = cleanup
	setSettingsGetter(() => ({
		...DefaultSettings,
		...(jsonStorage ?? {}),
	}))
	setGestureChannelGetter(() => latestChannel || channelFor())
	cleanup(
		getModules(withName(GUARD_NAME), ns => scanGuard(ns, cleanup), {
			returnNamespace: true,
		}),
	)
	cleanup(getModules(withProps('ChatInput'), ns => scan(ns, cleanup)))
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	init({ cleanup, jsonStorage }) {
		bootstrap(cleanup, jsonStorage.cache)
	},
	start({ cleanup, jsonStorage }) {
		bootstrap(cleanup, jsonStorage.cache)
	},
	SettingsComponent,
})
