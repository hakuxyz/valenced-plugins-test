import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { before, instead } from '@valenced/patcher'
import { createElement } from 'react'
import OnekoOverlay from './overlay'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import { setSettingsGetter, trackTouch } from './state'
import type { AnyFunction } from '@valenced/utils/types'
import type { Settings } from './shared'

type Cleanup = (...fns: Array<() => unknown>) => void

type LooseBefore = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (args: any[]) => any,
) => () => void

type LooseInstead = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (this: any, args: any[], original: AnyFunction) => any,
) => () => void

const beforeLoose = before as unknown as LooseBefore
const insteadLoose = instead as unknown as LooseInstead

const OVERLAY_KEY = 'hakuxyz-oneko-overlay'

/** Props objects we already injected into, to avoid duplicates. */
let mounted = new WeakSet<object>()
/** Parent/key pairs already hooked, so every module holding a view is patched. */
let patched = new WeakMap<object, Set<string>>()

/**
 * Metro re-exports members such as `react-native`'s `View` as getters on the
 * module namespace, and a plain assignment cannot replace a getter. Rewrite
 * such a member as a normal writable property holding the same function, so
 * the patcher can hook it instead of failing silently.
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

/** Recursively flattens nested style arrays, as `StyleSheet.flatten` does. */
function flattenStyle(style: unknown, out: unknown[] = []): unknown[] {
	if (Array.isArray(style)) {
		for (const entry of style) flattenStyle(entry, out)
	} else if (style != null) {
		out.push(style)
	}
	return out
}

/**
 * Structural match for the navigation stack holding the main and modal
 * routes. Minified builds drop `type.name`, so the navigation state in the
 * props is what identifies the element.
 */
function isNavStack(node: any): boolean {
	if (!node || typeof node !== 'object') return false

	const type = node.type
	const name = type?.name ?? type?.displayName ?? ''
	// Root/navigation markers.
	if (
		name === 'NativeStackViewInner' ||
		name === 'App' ||
		name === 'NavigationContainer' ||
		name === 'NativeStackNavigator' ||
		name === 'StackNavigator' ||
		name === 'ScreenStack' ||
		name === 'RNSScreenStack'
	)
		return true

	if (typeof name === 'string') {
		if (
			name.includes('NavigationContainer') ||
			name.includes('Navigator') ||
			name.includes('ScreenStack')
		)
			return true
	}

	const state = node.props?.state
	if (state && typeof state === 'object') {
		const names = state.routeNames
		if (Array.isArray(names)) {
			if (names.includes('main') && names.includes('modal')) return true
			if (names.includes('main') && names.length >= 2) return true
		}
		if (Array.isArray(state.routes) && typeof state.index === 'number')
			return true
	}

	return false
}

/** Whether this element is the app root view holding the navigation stack. */
function isRootProps(props: any): boolean {
	if (!props || typeof props !== 'object') return false
	// Deep flattened: the style may be a nested array of style objects.
	if (
		!flattenStyle(props.style).some(
			(s: any) =>
				s && typeof s === 'object' && (s.flex === 1 || s.flexGrow === 1),
		)
	) {
		return false
	}

	const children = props.children
	const list = Array.isArray(children)
		? children
		: children != null
			? [children]
			: []
	return list.some(isNavStack) || isNavStack(props)
}

/**
 * Injects the cat overlay and touch tracking into the given props.
 *
 * The props are the ones the caller passed to `View`, so mutating them
 * changes what `View` actually renders - the same approach the proven
 * root view injections use.
 */
function mountInto(props: any) {
	if (!props || typeof props !== 'object' || mounted.has(props)) return
	mounted.add(props)

	const children = props.children
	const list = Array.isArray(children)
		? children
		: children != null
			? [children]
			: []
	props.children = [...list, createElement(OnekoOverlay, { key: OVERLAY_KEY })]

	// The root view almost never becomes the responder itself, so the plain
	// responder events never reach it. Capture phase decision events are
	// dispatched from the root down for every touch, which makes them the
	// reliable place to observe touch positions. They must never claim the
	// responder, so the original result is passed through untouched.
	const prevStartCapture = props.onStartShouldSetResponderCapture
	const prevMoveCapture = props.onMoveShouldSetResponderCapture
	const prevGrant = props.onResponderGrant
	const prevMove = props.onResponderMove

	const wrapCapture = (previous: unknown) => (event: any) => {
		let result: any
		try {
			if (typeof previous === 'function') result = previous(event)
		} catch {}
		try {
			trackTouch(event)
		} catch {}
		return result
	}

	props.onStartShouldSetResponderCapture = wrapCapture(prevStartCapture)
	props.onMoveShouldSetResponderCapture = wrapCapture(prevMoveCapture)
	props.onResponderGrant = (event: any) => {
		try {
			trackTouch(event)
		} catch {}
		if (typeof prevGrant === 'function') prevGrant(event)
	}
	props.onResponderMove = (event: any) => {
		try {
			trackTouch(event)
		} catch {}
		if (typeof prevMove === 'function') prevMove(event)
	}
}

/** Checks the props of a `View` render and injects when it is the root. */
function mountProps(props: any) {
	try {
		if (isRootProps(props)) mountInto(props)
	} catch {}
}

function markPatched(parent: object, key: string): boolean {
	let keys = patched.get(parent)
	if (!keys) {
		keys = new Set()
		patched.set(parent, keys)
	}
	if (keys.has(key)) return false
	keys.add(key)
	return true
}

function unmarkPatched(parent: object, key: string) {
	patched.get(parent)?.delete(key)
}

/** Patches once and unmarks again when the lifecycle cleans the patch up. */
function register(
	cleanup: Cleanup,
	parent: object,
	key: string,
	patch: () => () => void,
) {
	if (!markPatched(parent, key)) return
	let unpatch: () => void
	try {
		unpatch = patch()
	} catch (error) {
		unmarkPatched(parent, key)
		throw error
	}
	cleanup(() => {
		unmarkPatched(parent, key)
		try {
			unpatch()
		} catch {}
	})
}

/** Patches a component so its props pass through `mountProps` before it runs. */
function patchComponent(
	target: any,
	parent: Record<string, AnyFunction>,
	key: string,
	cleanup: Cleanup,
	depth: number,
) {
	if (!target || depth > 3) return

	if (typeof target === 'function') {
		// Class component: render() takes no props, read them from the instance.
		if (typeof target.prototype?.render === 'function') {
			const proto = target.prototype as unknown as Record<string, AnyFunction>
			register(cleanup, proto, 'render', () =>
				insteadLoose(
					proto,
					'render',
					function (this: any, args: any[], original: AnyFunction) {
						mountProps(this?.props)
						return original.apply(this, args)
					},
				),
			)
			return
		}
		// Plain function component: the props are the first call argument.
		ensureWritable(parent, key)
		register(cleanup, parent, key, () =>
			beforeLoose(parent, key, (args: any[]) => {
				mountProps(args?.[0])
				// Valenced replaces the call arguments with the return value.
				return args
			}),
		)
		return
	}

	if (typeof target === 'object') {
		// forwardRef wrapper: render(props, ref).
		if (typeof target.render === 'function') {
			const ref = target as unknown as Record<string, AnyFunction>
			register(cleanup, ref, 'render', () =>
				beforeLoose(ref, 'render', (args: any[]) => {
					mountProps(args?.[0])
					return args
				}),
			)
			return
		}
		// memo wrapper: hook the inner type through the memo object.
		if (target.type) {
			patchComponent(
				target.type,
				target as Record<string, AnyFunction>,
				'type',
				cleanup,
				depth + 1,
			)
		}
	}
}

function install(cleanup: Cleanup) {
	mounted = new WeakSet<object>()
	patched = new WeakMap<object, Set<string>>()
	const scan = (namespace: unknown) => {
		try {
			const ns = namespace as Record<string, unknown> | null
			if (!ns || typeof ns !== 'object') return
			const view = ns.View
			if (!view) return
			patchComponent(
				view,
				ns as unknown as Record<string, AnyFunction>,
				'View',
				cleanup,
				0,
			)
		} catch {}
	}

	// Discord's common General view, which renders the app root.
	cleanup(getModules(withProps('Button', 'Text', 'View'), scan))
	// React Native's own View export as a fallback.
	cleanup(getModules(withProps('View', 'Text', 'Image'), scan))
	cleanup(getModules(withProps('View', 'Text', 'Image', 'ScrollView'), scan))
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	// Runs before the first render, so the cat is there from the start.
	init({ cleanup, jsonStorage }) {
		setSettingsGetter(() => ({
			...DefaultSettings,
			...(jsonStorage.cache ?? {}),
		}))
		install(cleanup)
	},
	start({ cleanup, jsonStorage }) {
		setSettingsGetter(() => ({
			...DefaultSettings,
			...(jsonStorage.cache ?? {}),
		}))
		install(cleanup)
	},
	SettingsComponent,
})
