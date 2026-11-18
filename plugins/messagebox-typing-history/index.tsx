import { ToastActionCreators } from '@valenced/discord/actions'
import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { after, before } from '@valenced/patcher'
import { findInTree } from '@valenced/utils/tree'
import { createElement } from 'react'
import { TextInput } from 'react-native'
import { attachGestures, setGestureChannelGetter } from './gestures'
import TypingHistoryPill from './pill'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import {
	channelFor,
	currentSettings,
	debugHistory,
	readDraft,
	record,
	seed,
	setApplier,
	setReporter,
	setSettingsGetter,
	settingsChanged,
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

/** Wrappers installed over an input handler, keyed by the original. */
const inputWrappers = new WeakMap<object, AnyFunction>()

/** Marks a handler as wrapped, so it is never wrapped a second time. */
const WRAPPED = '__hakuxyzTypingHistory'

/** Cleanup registry of the running lifecycle, used while rendering. */
let register: Cleanup | undefined
/** Latest input instance, the preferred writer for history. */
let latestInstance: any
/** Latest input props, used to resolve the live channel. */
let latestInputProps: any
/**
 * The ref object itself, not its value.
 *
 * `chatInputRef.current` is only filled in after the children mounted, and
 * the wrapper around the input is not guaranteed to render again afterwards.
 * Keeping the object means the instance can be resolved at the moment
 * history is applied instead of during whichever render happened to see it.
 */
let refHolderRef: any
/** Chat input module, used as a writer when the tree does not reach one. */
let chatModule: any
/** Module that owns `handleTextChanged`, observed and used as a writer. */
let chatHandler: any
/** Module that inserts text into the box, found for the diagnostics only. */
let insertModule: any
/** Module that sets or clears the box text, found for the diagnostics only. */
let setterModule: any
/** Every input element in the message box subtree, all of them live. */
let latestInputs: any[] = []
/** Channel the latest render belongs to. */
let latestChannel = ''
/**
 * Set once the guard wrapper render found a place for the pill, so the
 * `ChatInput` fallback does not inject a second copy of it.
 */
let guardActive = false
/** Set by the last `decorate` call when it found a place for the pill. */
let injected = false

/**
 * The only keys `findInTree` may descend into.
 *
 * Without this it walks every own key, and a React element exposes `_owner`,
 * `ref` and `type` right next to `props`. `_owner` is a fiber, and a fiber
 * links to `child`, `sibling`, `return` and `alternate`, so the walk escapes
 * into the whole application tree on every render and saturates the JS
 * thread. Restricting the walk to the element tree keeps it linear and
 * makes the fiber graph unreachable.
 */
const WALKABLE = new Set(['props', 'children'])

/** Search depth of the bounded walk, generous for deep input subtrees. */
const MAX_FIND_DEPTH = 80

/** `findInTree` only narrows for type guards, so wrap every search. */
function findNode(tree: any, predicate: (node: any) => boolean): any {
	return findInTree(
		tree,
		(node: any): node is Record<string, any> => {
			try {
				return predicate(node)
			} catch {
				return false
			}
		},
		{ walkable: WALKABLE, maxDepth: MAX_FIND_DEPTH },
	) as any
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
 *
 * The React Native `TextInput` is matched by identity or by name as well:
 * the real message box does not always carry an `onChangeText` of its own,
 * and without a match there would be no write path at all.
 */
function isInputNode(node: any): boolean {
	if (!node || typeof node !== 'object') return false
	const props = node.props
	if (!props || typeof props !== 'object') return false
	if (node.type === TextInput) return true
	const name = typeName(node)
	if (name === 'TextInput' || name.startsWith('TextInput')) return true
	if (typeof props.onChangeText !== 'function') return false
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
	const instance = resolveInstance()
	return channelFor(
		channelFrom(
			latestInputProps?.channelId,
			instance?.props?.channelId,
			instance?.props?.channel?.id,
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
	// Only `props.children` is ever followed, so this stays linear.
	if (node == null || depth > MAX_FIND_DEPTH) return undefined

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

/** Marks an object whose handler is already observed. */
const observed = new WeakSet<object>()

/**
 * Observes typing through `handleTextChanged` on whatever object holds it.
 *
 * Reading keystrokes this way survives minification, which is why the known
 * chat plugins use the same hook. The receiver is left untouched, so the
 * original call keeps working exactly as before.
 */
function observeHandler(target: any): (() => void) | undefined {
	if (
		!target ||
		(typeof target !== 'object' && typeof target !== 'function') ||
		typeof target.handleTextChanged !== 'function' ||
		observed.has(target)
	)
		return undefined
	try {
		const unpatch = beforeLoose(target, 'handleTextChanged', (args: any[]) => {
			try {
				const text = args?.[0]
				if (typeof text === 'string') record(liveChannel(), text)
			} catch {}
			// Valenced replaces the call arguments with the return value.
			return args
		})
		observed.add(target)
		return () => {
			observed.delete(target)
			unpatch()
		}
	} catch {
		return undefined
	}
}

/** Observes typing through the instance handler, once per instance. */
function wireInstance(instance: any) {
	if (wired.has(instance)) return
	const unpatch = observeHandler(instance)
	if (!unpatch) return
	wired.add(instance)
	register?.(() => {
		wired.delete(instance)
		unpatch()
	})
}

/**
 * Records keystrokes through the input's own `onChangeText`.
 *
 * This is the path that works without an instance, which matters because the
 * ref is empty during the first render. The handler is wrapped in place, once
 * per original function, and the original is called unchanged with whatever
 * receiver it was called with before.
 */
function wireInput(inputProps: any) {
	try {
		const original = inputProps?.onChangeText
		if (typeof original !== 'function') return
		if ((original as any)[WRAPPED]) return

		let wrapper = inputWrappers.get(original)
		if (!wrapper) {
			wrapper = function (this: any, ...args: any[]) {
				try {
					const text = args[0]
					if (typeof text === 'string') record(liveChannel(), text)
				} catch {}
				return (original as AnyFunction).apply(this, args)
			}
			;(wrapper as any)[WRAPPED] = true
			inputWrappers.set(original, wrapper)
		}
		inputProps.onChangeText = wrapper
	} catch {}
}

/**
 * Resolves the chat input instance when it is actually needed.
 *
 * Prefers an object that really exposes the handler, so a callback ref or a
 * native input handle can never be mistaken for it.
 */
function resolveInstance(): any {
	const candidates = [
		refTarget(refHolderRef),
		refTarget(latestInputProps?.chatInputRef),
		refTarget(latestInputProps?.inputRef),
		latestInstance,
	]
	let fallback: any
	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== 'object') continue
		if (typeof candidate.handleTextChanged === 'function') {
			latestInstance = candidate
			wireInstance(candidate)
			return candidate
		}
		fallback ??= candidate
	}
	return fallback
}

/**
 * Collects every input element in the message box subtree.
 *
 * The node `locate` returns is the outermost match, and that is not always
 * the handler Discord actually calls, so all of them are recorded through
 * and written to. The elements themselves are kept, not their props: an
 * input without an `onChangeText` is still a place the text can live, and
 * dropping it would hide that from the diagnostics.
 */
function collectInputs(node: any, out: any[], depth = 0) {
	if (node == null || depth > MAX_FIND_DEPTH) return
	if (Array.isArray(node)) {
		for (const child of node) collectInputs(child, out, depth + 1)
		return
	}
	if (typeof node !== 'object') return
	const props = node.props
	if (!props || typeof props !== 'object') return
	if (isInputNode(node) || typeof props.onChangeText === 'function')
		out.push(node)
	if (props.children != null) collectInputs(props.children, out, depth + 1)
}

/**
 * Writes a history entry back into the message box.
 *
 * The text can be reached through the input handlers, through the instance
 * behind `chatInputRef` and through the chat input modules, and which of them
 * is alive depends on when the last render happened. Every path that exists
 * is called with the same text: they all mean "the text is now this", each
 * one is guarded, and calling more than one is harmless.
 */
function applyText(text: string) {
	const called = new Set<unknown>()

	const call = (owner: any, key: string) => {
		try {
			const fn = owner?.[key]
			if (typeof fn !== 'function' || called.has(fn)) return
			called.add(fn)
			fn.call(owner, text)
		} catch {}
	}

	// What the visible input is driven by: every handler of the subtree.
	for (const el of latestInputs) call(el?.props ?? el, 'onChangeText')

	// The instance behind the ref, resolved only now.
	const instance = resolveInstance()
	call(instance, 'handleTextChanged')
	call(instance?.props, 'onChangeText')

	// The module level handlers, which do not depend on any render.
	call(chatHandler, 'handleTextChanged')
	call(chatModule, 'changeText')
}

/**
 * Reports what an undo or redo attempt did.
 *
 * The app cannot be debugged from outside, so the state of every write path
 * goes into a toast a moment later, once React had the chance to render the
 * new text. Kept short on purpose: toasts truncate long text.
 */
function diagnose(
	action: string,
	channelId: string,
	ok: boolean,
	expected?: string,
) {
	const clip = (value: unknown, max = 8) => {
		try {
			const text = value === undefined || value === null ? '-' : String(value)
			return text.length > max ? `${text.slice(0, max)}…` : text
		} catch {
			return '-'
		}
	}

	try {
		setTimeout(() => {
			try {
				const counts = debugHistory(channelId)
				const el = latestInputs[0]
				const props = el?.props ?? el
				const instance = resolveInstance()
				const draft = readDraft(channelId)
				const value =
					typeof props?.value === 'string'
						? props.value
						: props?.defaultValue != null
							? `d:${props.defaultValue}`
							: '-'
				const native = refTarget(props?.ref ?? el?.ref)
				const hasNative =
					native &&
					(typeof native.clear === 'function' ||
						typeof native.getNativeRef === 'function' ||
						typeof native.setNativeProps === 'function')
				const flags = [
					latestInputs.length > 0 ? 'p1' : 'p0',
					instance && typeof instance.handleTextChanged === 'function'
						? 'i1'
						: 'i0',
					chatHandler ? 'h1' : 'h0',
					chatModule ? 'm1' : 'm0',
					insertModule ? 's1' : 's0',
					setterModule ? 't1' : 't0',
					hasNative ? 'r1' : 'r0',
				].join('')
				const want = expected === undefined ? '-' : clip(expected)
				ToastActionCreators.open('HAKUXYZ_TYPING_HISTORY_DIAG', {
					text: `${action}:${ok ? 'y' : 'n'} ${counts.past}/${counts.future} v:${clip(value)} d:${clip(draft)} w:${want} ${flags}`,
					variant: 'default',
				})
			} catch {}
		}, 400)
	} catch {}
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

		const inputs: any[] = []
		if (located) collectInputs(located.input, inputs)
		// Keep the last known set: a later render without an input in view
		// must not take the write paths away.
		if (inputs.length > 0) latestInputs = inputs
		const inputEl = inputs[0] ?? located?.input
		const inputProps = inputEl?.props ?? located?.input?.props
		if (inputProps) latestInputProps = inputProps

		// Keep the ref object, not its value: the value only exists after the
		// children mounted, and this component may never render again.
		const refs = [
			refHolder?.props?.chatInputRef,
			inputProps?.chatInputRef,
			inputProps?.inputRef,
			inputProps?.textInputRef,
			inputProps?.ref,
			inputEl?.ref,
		]
		for (const ref of refs) {
			if (ref && typeof ref === 'object' && 'current' in ref) {
				refHolderRef = ref
				break
			}
		}

		for (const el of inputs) wireInput(el?.props ?? el)
		const instance = resolveInstance()

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
		// Keystrokes, independent of which instance holds the ref.
		const unobserve = observeHandler(proto)
		cleanup(() => {
			unpatch()
			unobserve?.()
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

function bootstrap(cleanup: Cleanup, storage: any) {
	register = cleanup
	// Read the storage on every access: `cache` is replaced when the document
	// loads or is written to, so it must not be captured once here.
	setSettingsGetter(() => ({
		...DefaultSettings,
		...(storage?.cache ?? {}),
	}))
	if (typeof storage?.subscribe === 'function') {
		cleanup(storage.subscribe(() => settingsChanged()))
	}
	setGestureChannelGetter(() => latestChannel || channelFor())
	setApplier(applyText)
	setReporter(diagnose)

	// Module level handlers: they keep working across a remount of the input.
	cleanup(
		getModules(
			withProps('handleTextChanged'),
			module => {
				chatHandler ??= module
				const unpatch = observeHandler(module)
				if (unpatch) cleanup(unpatch)
			},
			{ max: 3 },
		),
	)
	cleanup(
		getModules(
			withProps('handleSendMessage', 'changeText'),
			module => {
				chatModule ??= module
			},
			{ max: 1 },
		),
	)
	// Diagnostics only: modules that can write into the box on some builds.
	cleanup(
		getModules(
			withProps('selectGIF', 'insertText'),
			module => {
				insertModule ??= module
			},
			{ max: 1 },
		),
	)
	cleanup(
		getModules(
			withProps('setText', 'clearText'),
			module => {
				setterModule ??= module
			},
			{ max: 3 },
		),
	)
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
		bootstrap(cleanup, jsonStorage)
	},
	start({ cleanup, jsonStorage }) {
		bootstrap(cleanup, jsonStorage)
	},
	SettingsComponent,
})
