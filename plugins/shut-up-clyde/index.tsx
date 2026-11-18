import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
	withProps,
} from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { cloneElement } from 'react'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import { currentSettings, setStorage } from './state'
import type { AnyFunction } from '@valenced/utils/types'
import type { ElementType, ReactElement } from 'react'
import type { Settings } from './shared'

type Cleanup = (...unpatches: Array<() => unknown>) => void

type LooseInstead = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (this: any, args: any[], original: AnyFunction) => any,
) => () => boolean

const insteadLoose = instead as unknown as LooseInstead

const CHAT_INPUT_COMPONENTS = ['ChatInputActions', 'ChatInputRightActions']

const UPSELL_COMPONENTS = [
	'AppIconSettingsUpsell',
	'AppIconTier2Upsell',
	'AppIconUpsell',
	'AppIconUpsellCard',
	'AppIconUpsellView',
	'AppIconsUpsell',
	'AppIconsUpsellView',
	'NitroAppIconUpsell',
	'NitroPromoCard',
	'NitroPromotion',
	'NitroUpsell',
	'NitroUpsellCard',
	'PremiumUpsell',
	'UpsellButton',
]

const patched = new Set<AnyFunction>()
const jsxPatched = new WeakSet<object>()

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null
}

/**
 * Metro re-exports members as getters. Turn such a member into a writable
 * value property so the patcher can hook it.
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

const withFunctionName = createFilterGenerator<[name: string]>(
	([name], _id, exports) => {
		if (typeof exports === 'function') return exports.name === name
		if (!isRecord(exports)) return false
		if (typeof exports[name] === 'function') return true

		return (
			isRecord(exports.default) && typeof exports.default[name] === 'function'
		)
	},
	([name]) => `shutUpClyde.functionName(${name})`,
	FilterScopes.Initialized,
)

function componentMatches(value: any, name: string): boolean {
	if (typeof value !== 'function' && !isRecord(value)) return false
	return value.displayName === name || value.name === name
}

function resolveComponent(exports: any, name: string): any {
	if (!isRecord(exports) && typeof exports !== 'function') return undefined

	const candidates = [
		exports?.[name]?.type,
		exports?.default?.type,
		exports?.type,
		exports?.[name],
		exports?.default,
		exports,
	]

	for (const candidate of candidates) {
		if (componentMatches(candidate, name)) return candidate
	}
	return undefined
}

const withComponentName = createFilterGenerator<[name: string]>(
	([name], _id, exports) => {
		if (!isRecord(exports) && typeof exports !== 'function') return false

		const candidates = [
			exports?.[name]?.type,
			exports?.default?.type,
			exports?.type,
			exports?.[name],
			exports?.default,
			exports,
		]

		return candidates.some(candidate => componentMatches(candidate, name))
	},
	([name]) => `shutUpClyde.componentName(${name})`,
	FilterScopes.Initialized,
)

function patchMethod(
	parent: any,
	key: string,
	shouldBlock: (args: any[]) => boolean,
	cleanup: Cleanup,
): void {
	if (!isRecord(parent) || typeof parent[key] !== 'function') return

	const original = parent[key] as AnyFunction
	if (patched.has(original)) return

	try {
		ensureWritable(parent, key)
		patched.add(original)

		const unpatch = insteadLoose(parent, key, (args, originalFn) => {
			let blocked = false
			try {
				blocked = shouldBlock(args)
			} catch {}
			if (blocked) return undefined
			return originalFn(...args)
		})

		cleanup(() => {
			patched.delete(original)
			unpatch()
		})
	} catch {
		patched.delete(original)
	}
}

function patchNamedFunction(
	exports: any,
	name: string,
	shouldBlock: (args: any[]) => boolean,
	cleanup: Cleanup,
): void {
	patchMethod(exports, name, shouldBlock, cleanup)
	if (isRecord(exports)) {
		patchMethod(exports.default, name, shouldBlock, cleanup)
	}
}

function isClydeAuthor(author: unknown): boolean {
	if (!isRecord(author)) return false
	if (author.bot !== true && author.isBot !== true) return false

	const username =
		typeof author.username === 'string' ? author.username.toLowerCase() : ''
	const name = typeof author.name === 'string' ? author.name.toLowerCase() : ''
	const avatar =
		typeof author.avatar === 'string' ? author.avatar.toLowerCase() : ''

	return username === 'clyde' || name === 'clyde' || avatar === 'clyde'
}

function isClydeMessage(payload: unknown): boolean {
	if (!isRecord(payload)) return false
	if (isClydeAuthor(payload.author)) return true
	return isRecord(payload.message) && isClydeAuthor(payload.message.author)
}

function installGiftButtonPatch(
	exports: any,
	name: string,
	cleanup: Cleanup,
): void {
	const component = resolveComponent(exports, name)
	if (!component || jsxPatched.has(component)) return

	try {
		jsxPatched.add(component)
		const unpatch = afterJSX(component as ElementType, element => {
			try {
				const settings = currentSettings()
				if (!settings.enabled || !settings.hideGiftButton) return element
				if (element.props?.shouldShowGiftButton === false) return element

				return cloneElement(element as ReactElement<Record<string, unknown>>, {
					shouldShowGiftButton: false,
				})
			} catch {
				return element
			}
		})

		cleanup(() => {
			jsxPatched.delete(component)
			unpatch()
		})
	} catch {
		jsxPatched.delete(component)
	}
}

function installUpsellPatch(
	exports: any,
	name: string,
	cleanup: Cleanup,
): void {
	const component = resolveComponent(exports, name)
	if (!component || jsxPatched.has(component)) return

	try {
		jsxPatched.add(component)
		const unpatch = afterJSX(component as ElementType, element => {
			try {
				const settings = currentSettings()
				if (!settings.enabled || !settings.hideNitroPrompts) return element
				return null
			} catch {
				return element
			}
		})

		cleanup(() => {
			jsxPatched.delete(component)
			unpatch()
		})
	} catch {
		jsxPatched.delete(component)
	}
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},

	start({ cleanup, jsonStorage }) {
		setStorage(jsonStorage)

		cleanup(
			getModules(
				withFunctionName('sendClydeError'),
				mod => {
					patchNamedFunction(
						mod,
						'sendClydeError',
						() => {
							const settings = currentSettings()
							return settings.enabled && settings.hideClydeErrors
						},
						cleanup,
					)
				},
				{ max: 5 },
			),
		)

		cleanup(
			getModules(
				withProps('receiveMessage'),
				mod => {
					patchNamedFunction(
						mod,
						'receiveMessage',
						args => {
							const settings = currentSettings()
							return (
								settings.enabled &&
								settings.hideClydeMessages &&
								isClydeMessage(args[1] ?? args[0])
							)
						},
						cleanup,
					)
				},
				{ max: 5 },
			),
		)

		for (const name of CHAT_INPUT_COMPONENTS) {
			cleanup(
				getModules(
					withComponentName(name),
					mod => installGiftButtonPatch(mod, name, cleanup),
					{ max: 5 },
				),
			)
		}

		for (const name of UPSELL_COMPONENTS) {
			cleanup(
				getModules(
					withComponentName(name),
					mod => installUpsellPatch(mod, name, cleanup),
					{ max: 5 },
				),
			)
		}
	},

	SettingsComponent,
})
