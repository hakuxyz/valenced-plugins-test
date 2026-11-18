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
	store,
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
/** Callback ref seen for the chat input, captured when invoked. */
let callbackRefSeen = false
/** Modules that can write text to the chat input. */
const chatModules = new Set<any>()
/** Module that owns `handleTextChanged`, observed and used as a writer. */
let chatHandler: any
/** Modules that may insert text. */
const insertModules = new Set<any>()
/** Modules that may set/clear text. */
const setterModules = new Set<any>()
/** Draft store modules. */
const draftModules = new Set<any>()
/** ComponentDispatch-like modules. */
let componentDispatch: any
/** Flux dispatcher module. */
let fluxDispatcher: any
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

const WALKABLE = new Set(['props', 'children'])
const MAX_FIND_DEPTH = 80

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

function isInputNode(node: any): boolean {
	if (!node || typeof node !== 'object') return false
	const props = node.props
	if (!props || typeof props !== 'object') return false
	if (node.type === TextInput) return true
	const name = typeName(node)
	if (name === 'TextInput' || name.startsWith('TextInput')) return true
	if (typeof props.onChangeText === 'function') return false
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

function locate(node: any, ancestors: any[], depth = 0): Located | undefined {
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

const observed = new WeakSet<object>()

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

function collectInputs(node: any, out: any[], depth = 0) {
	if (node == null || depth > MAX_FIND_DEPTH) return
	if (Array.isArray(node)) {
		for (const child of node) collectInputs(child, out, depth + 1)
		return
	}
	if (typeof node !== 'object') return
	const props = node.props
	if (!props || typeof props !== 'object') return
	const name = typeName(node)
	const looksLikeInput =
		name === 'TextInput' ||
		name.startsWith('TextInput') ||
		typeof props.onChangeText === 'function' ||
		((typeof props.value === 'string' ||
			typeof props.defaultValue === 'string') &&
			('onSelectionChange' in props ||
				'multiline' in props ||
				'placeholder' in props ||
				'onSubmitEditing' in props ||
				'editable' in props)) ||
		('text' in props && typeof props.onChange === 'function')
	if (looksLikeInput && name !== 'View' && name !== 'RCTView') out.push(node)
	if (props.children != null) collectInputs(props.children, out, depth + 1)
}

function remember(module: any, set: Set<any>) {
	if (!module || (typeof module !== 'object' && typeof module !== 'function'))
		return
	set.add(module)
}

function getDispatchFn(): ((name: string, payload: any) => void) | undefined {
	const candidates = [
		componentDispatch,
		componentDispatch?.ComponentDispatch,
		componentDispatch?.default,
		componentDispatch?.default?.ComponentDispatch,
	]
	for (const cand of candidates) {
		try {
			if (cand && typeof cand.dispatchToLastSubscribed === 'function') {
				return (name: string, payload: any) =>
					cand.dispatchToLastSubscribed(name, payload)
			}
		} catch {}
	}
	return undefined
}

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

	const callWithChannel = (owner: any, key: string, channelId: string) => {
		try {
			const fn = owner?.[key]
			if (typeof fn !== 'function' || called.has(fn)) return
			called.add(fn)
			// try (channelId, text) and (text)
			try {
				fn.call(owner, channelId, text)
			} catch {}
			try {
				fn.call(owner, text)
			} catch {}
		} catch {}
	}

	const setNative = (target: any) => {
		try {
			const t = refTarget(target)
			if (!t || typeof t !== 'object' || called.has(t)) return
			called.add(t)
			if (typeof t.setNativeProps === 'function') {
				try {
					t.setNativeProps({ text })
				} catch {}
			}
			if (
				typeof t.focus === 'function' &&
				typeof t.setNativeProps === 'function'
			) {
				// keep focus state; some inputs need it
			}
		} catch {}
	}

	// TextInput.State focused input (RN)
	try {
		const state = (TextInput as any)?.State
		if (state) {
			const focusedId =
				typeof state.currentlyFocusedField === 'function'
					? state.currentlyFocusedField()
					: undefined
			const focusedInput =
				typeof state.currentlyFocusedInput === 'function'
					? state.currentlyFocusedInput()
					: undefined
			if (focusedInput) setNative(focusedInput)
			if (focusedId && typeof (state as any).getTextInputRef === 'function') {
				try {
					setNative((state as any).getTextInputRef(focusedId))
				} catch {}
			}
		}
	} catch {}

	// What the visible input is driven by: every handler of the subtree.
	for (const el of latestInputs) {
		const props = el?.props ?? el
		call(props, 'onChangeText')
		setNative(props?.ref ?? el?.ref)
	}

	// The instance behind the ref, resolved only now.
	const instance = resolveInstance()
	call(instance, 'handleTextChanged')
	call(instance?.props, 'onChangeText')

	for (const ref of [
		instance?._inputRef,
		instance?.inputRef,
		instance?._textInput,
		instance?.textInputRef,
		instance?.input,
		instance?.props?.inputRef,
		instance?.props?.textInputRef,
		refTarget(refHolderRef),
		latestInputProps?.chatInputRef,
		latestInputProps?.inputRef,
		latestInputProps?.textInputRef,
	]) {
		setNative(ref)
	}

	try {
		if (instance && typeof instance.setState === 'function') {
			instance.setState({ text, value: text })
		}
	} catch {}
	try {
		if (instance && typeof instance.forceUpdate === 'function') {
			instance.forceUpdate()
		}
	} catch {}

	const channelId = liveChannel()

	// Module level handlers
	call(chatHandler, 'handleTextChanged')
	for (const mod of chatModules) {
		call(mod, 'changeText')
		call(mod, 'setText')
		call(mod, 'handleTextChanged')
		callWithChannel(mod, 'changeText', channelId)
		callWithChannel(mod, 'setText', channelId)
	}
	for (const mod of setterModules) {
		call(mod, 'setText')
		call(mod, 'clearText') // may be no-op for replace, but harmless to try? no, clear would empty; skip clear logic
	}
	for (const mod of insertModules) {
		call(mod, 'insertText')
		// insertText usually appends; not a replace, but try anyway
	}

	// Draft stores and flux
	const allDrafts = new Set<any>(draftModules)
	try {
		const ds = store('DraftStore')
		if (ds) allDrafts.add(ds)
	} catch {}
	for (const ds of allDrafts) {
		if (!ds || !channelId) continue
		try {
			if (typeof ds.saveDraft === 'function') ds.saveDraft(channelId, text, 0)
		} catch {}
		try {
			if (typeof ds.changeDraft === 'function')
				ds.changeDraft(channelId, text, 0)
		} catch {}
		try {
			if (typeof ds.changeDraft === 'function') ds.changeDraft(channelId, text)
		} catch {}
	}

	// Flux dispatch for draft change
	try {
		const dispatcher = fluxDispatcher ?? store('FluxDispatcher' as any)
		if (dispatcher && typeof dispatcher.dispatch === 'function' && channelId) {
			try {
				dispatcher.dispatch({ type: 'DRAFT_CHANGE', channelId, draft: text })
			} catch {}
			try {
				dispatcher.dispatch({ type: 'DRAFT_SAVE', channelId, draft: text })
			} catch {}
		}
	} catch {}

	// ComponentDispatch attempts (insert-oriented; may not replace, but worth trying)
	const dispatch = getDispatchFn()
	if (dispatch) {
		const payloads = [
			{ content: text },
			{ plainText: text },
			{ text },
			{ content: text, plainText: text },
		]
		for (const payload of payloads) {
			try {
				dispatch('INSERT_TEXT', payload)
			} catch {}
		}
		// Some builds might support SET_TEXT-like actions
		for (const name of ['SET_TEXT', 'TEXT_CHANGED', 'REPLACE_TEXT']) {
			for (const payload of payloads) {
				try {
					dispatch(name, payload)
				} catch {}
			}
		}
	}
}

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
				const nativeCandidates = [
					refTarget(props?.ref ?? el?.ref),
					refTarget(instance?._inputRef),
					refTarget(instance?.inputRef),
					refTarget(instance?._textInput),
					refTarget(instance?.textInputRef),
					refTarget(instance?.input),
					refTarget(instance?.props?.inputRef),
					refTarget(instance?.props?.textInputRef),
					refTarget(refHolderRef),
				]
				const hasNative = nativeCandidates.some(
					native =>
						native &&
						(typeof native.clear === 'function' ||
							typeof native.getNativeRef === 'function' ||
							typeof native.setNativeProps === 'function'),
				)
				const flags = [
					latestInputs.length > 0 ? 'p1' : 'p0',
					instance && typeof instance.handleTextChanged === 'function'
						? 'i1'
						: 'i0',
					chatHandler ? 'h1' : 'h0',
					chatModules.size > 0 ? 'm1' : 'm0',
					insertModules.size > 0 ? 's1' : 's0',
					setterModules.size > 0 ? 't1' : 't0',
					hasNative ? 'r1' : 'r0',
					draftModules.size > 0 ? 'g1' : 'g0',
					callbackRefSeen ? 'c1' : 'c0',
					getDispatchFn() ? 'x1' : 'x0',
					fluxDispatcher ? 'f1' : 'f0',
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
		if (!located && !refHolder) return result

		const inputs: any[] = []
		const pushInputs = (root: any) => {
			if (!root) return
			const found: any[] = []
			collectInputs(root, found)
			for (const node of found) {
				if (!inputs.includes(node)) inputs.push(node)
			}
		}

		if (located) pushInputs(located.input)
		if (inputs.length === 0 && refHolder) pushInputs(refHolder)
		if (inputs.length === 0) {
			const found = findNode(result, node => {
				const props = node?.props
				if (!props || typeof props !== 'object') return false
				if (typeof props.onChangeText === 'function') return true
				const name = typeName(node)
				if (name === 'TextInput' || name.startsWith('TextInput')) return true
				return (
					(typeof props.value === 'string' ||
						typeof props.defaultValue === 'string') &&
					('onSelectionChange' in props ||
						'multiline' in props ||
						'placeholder' in props ||
						'onSubmitEditing' in props)
				)
			})
			if (found) pushInputs(found)
		}
		if (inputs.length === 0) pushInputs(result)

		if (inputs.length > 0) latestInputs = inputs
		const inputEl = inputs[0] ?? located?.input
		const inputProps = inputEl?.props ?? located?.input?.props
		if (inputProps) latestInputProps = inputProps

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
			if (typeof ref === 'function' && !(ref as any)[WRAPPED]) {
				callbackRefSeen = true
				const original = ref as AnyFunction
				const wrapper = function (this: any, value: any) {
					try {
						if (value && typeof value === 'object') {
							latestInstance = value
							wireInstance(value)
						}
					} catch {}
					return original.call(this, value)
				}
				;(wrapper as any)[WRAPPED] = true
				try {
					if (refHolder?.props?.chatInputRef === ref)
						refHolder.props.chatInputRef = wrapper
					else if (inputProps?.chatInputRef === ref)
						inputProps.chatInputRef = wrapper
					else if (inputProps?.inputRef === ref) inputProps.inputRef = wrapper
					else if (inputProps?.textInputRef === ref)
						inputProps.textInputRef = wrapper
					else if (inputProps?.ref === ref) inputProps.ref = wrapper
					else if (inputEl?.ref === ref) inputEl.ref = wrapper
				} catch {}
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

	if (
		typeof target === 'function' &&
		typeof target.prototype?.render === 'function'
	) {
		seen.add(target.prototype)
		const proto = target.prototype as unknown as Record<string, AnyFunction>
		const unpatch = afterLoose(proto, 'render', result =>
			decorate(result, !guardActive),
		)
		const unobserve = observeHandler(proto)
		cleanup(() => {
			unpatch()
			unobserve?.()
			seen.delete(target)
			seen.delete(target.prototype)
		})
		return
	}

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

	cleanup(
		getModules(
			withProps('handleTextChanged'),
			module => {
				chatHandler ??= module
				remember(module, chatModules)
				const unpatch = observeHandler(module)
				if (unpatch) cleanup(unpatch)
			},
			{ max: 5 },
		),
	)
	cleanup(
		getModules(
			withProps('handleSendMessage', 'changeText'),
			module => {
				remember(module, chatModules)
			},
			{ max: 3 },
		),
	)
	cleanup(
		getModules(
			withProps('changeText'),
			module => {
				remember(module, chatModules)
			},
			{ max: 5 },
		),
	)
	cleanup(
		getModules(
			withProps('selectGIF', 'insertText'),
			module => {
				remember(module, insertModules)
			},
			{ max: 2 },
		),
	)
	cleanup(
		getModules(
			withProps('insertText'),
			module => {
				remember(module, insertModules)
			},
			{ max: 5 },
		),
	)
	cleanup(
		getModules(
			withProps('setText', 'clearText'),
			module => {
				remember(module, setterModules)
			},
			{ max: 5 },
		),
	)
	cleanup(
		getModules(
			withProps('setText'),
			module => {
				remember(module, setterModules)
			},
			{ max: 5 },
		),
	)
	cleanup(
		getModules(
			withProps('getDraft', 'saveDraft'),
			module => {
				remember(module, draftModules)
			},
			{ max: 2 },
		),
	)
	cleanup(
		getModules(
			withProps('getDraft', 'changeDraft'),
			module => {
				remember(module, draftModules)
			},
			{ max: 2 },
		),
	)
	cleanup(
		getModules(
			withProps('dispatchToLastSubscribed'),
			module => {
				componentDispatch ??= module
			},
			{ max: 2 },
		),
	)
	cleanup(
		getModules(
			withProps('ComponentDispatch'),
			module => {
				componentDispatch ??= module
			},
			{ max: 2 },
		),
	)
	cleanup(
		getModules(
			withProps('dispatch', 'subscribe', 'isDispatching'),
			module => {
				fluxDispatcher ??= module
			},
			{ max: 1 },
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
