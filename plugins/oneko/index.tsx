import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import { createElement } from 'react'
import OnekoOverlay from './overlay'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import { setSettingsGetter, trackTouch } from './state'
import type { AnyFunction } from '@valenced/utils/types'
import type { Settings } from './shared'

type Cleanup = (...fns: Array<() => unknown>) => void

type LooseAfter = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (result: any) => any,
) => () => void

const afterLoose = after as unknown as LooseAfter

const OVERLAY_KEY = 'hakuxyz-oneko-overlay'

/** Props objects we already injected into, to avoid duplicates. */
const mounted = new WeakSet<object>()

function styleList(style: unknown): unknown[] {
	if (Array.isArray(style)) return style
	if (style && typeof style === 'object') return [style]
	return []
}

/**
 * Structural match for the navigation stack holding the main and modal
 * routes. Minified builds drop `type.name`, so the navigation state in the
 * props is what identifies the element.
 */
function isNavStack(node: any): boolean {
	if (!node || typeof node !== 'object') return false

	const state = node.props?.state
	if (state && typeof state === 'object') {
		const names = state.routeNames
		if (Array.isArray(names) && names.includes('main') && names.length >= 2) {
			return true
		}
		if (Array.isArray(state.routes) && typeof state.index === 'number') {
			return true
		}
	}

	const type = node.type
	return (
		type?.name === 'NativeStackViewInner' ||
		type?.displayName === 'NativeStackViewInner'
	)
}

/** Whether this element is the app root view holding the navigation stack. */
function isRootProps(props: any): boolean {
	if (!props || typeof props !== 'object') return false
	if (
		!styleList(props.style).some(
			(s: any) => s && typeof s === 'object' && s.flex === 1,
		)
	) {
		return false
	}

	const children = props.children
	const list = Array.isArray(children) ? children : [children]
	if (list.some(isNavStack)) return true

	// The root view itself may carry the navigation state.
	return isNavStack(props)
}

/** Injects the cat overlay and touch tracking into the root view props. */
function mountInto(props: any) {
	if (mounted.has(props)) return
	mounted.add(props)

	const children = props.children
	const list = Array.isArray(children)
		? children
		: children != null
			? [children]
			: []
	props.children = [...list, createElement(OnekoOverlay, { key: OVERLAY_KEY })]

	const prevGrant = props.onResponderGrant
	const prevMove = props.onResponderMove
	props.onResponderGrant = (event: any) => {
		trackTouch(event)
		if (typeof prevGrant === 'function') prevGrant(event)
	}
	props.onResponderMove = (event: any) => {
		trackTouch(event)
		if (typeof prevMove === 'function') prevMove(event)
	}
}

function tryMount(result: any): any {
	try {
		if (result && typeof result === 'object' && isRootProps(result.props)) {
			mountInto(result.props)
		}
	} catch {}
	return result
}

/** Parent/key pairs already hooked, so every module holding a view is patched. */
const patched = new WeakMap<object, Set<string>>()

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

/** Patches a component so its rendered element passes through tryMount. */
function patchComponent(
	target: any,
	parent: Record<string, AnyFunction>,
	key: string,
	cleanup: Cleanup,
	depth: number,
) {
	if (!target || depth > 3) return

	if (typeof target === 'function') {
		if (typeof target.prototype?.render === 'function') {
			const proto = target.prototype as unknown as Record<string, AnyFunction>
			register(cleanup, proto, 'render', () =>
				afterLoose(proto, 'render', tryMount),
			)
			return
		}
		register(cleanup, parent, key, () => afterLoose(parent, key, tryMount))
		return
	}

	if (typeof target === 'object') {
		if (typeof target.render === 'function') {
			const ref = target as unknown as Record<string, AnyFunction>
			register(cleanup, ref, 'render', () =>
				afterLoose(ref, 'render', tryMount),
			)
			return
		}
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
