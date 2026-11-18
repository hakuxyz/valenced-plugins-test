import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { before } from '@valenced/patcher'
import SettingsComponent from './settings'
import { DefaultSettings, rewriteContent } from './shared'
import { currentSettings, setStorage } from './state'
import type { AnyFunction } from '@valenced/utils/types'
import type { Settings } from './shared'

type Cleanup = (...fns: Array<() => unknown>) => void

type LooseBefore = (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: (args: any[]) => any,
) => () => void

const beforeLoose = before as unknown as LooseBefore

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

const patched = new Set<AnyFunction>()

function install(
	parent: any,
	key: string,
	payloadIndex: number,
	cleanup: Cleanup,
): void {
	if (!parent || typeof parent[key] !== 'function') return

	const original = parent[key] as AnyFunction
	if (patched.has(original)) return

	try {
		ensureWritable(parent, key)
		patched.add(original)

		const unpatch = beforeLoose(parent, key, (args: any[]) => {
			try {
				const settings = currentSettings()
				if (!settings.enabled) return args
				if (key === 'editMessage' && !settings.rewriteEdits) return args

				const payload = args?.[payloadIndex]
				if (
					typeof payload !== 'string' &&
					(payload == null || typeof payload !== 'object')
				) {
					return args
				}

				if (typeof payload === 'string') {
					const content = rewriteContent(payload, settings)
					if (content === payload) return args
					const next = [...args]
					next[payloadIndex] = content
					return next
				}

				if (typeof payload.content !== 'string') return args
				const content = rewriteContent(payload.content, settings)
				if (content === payload.content) return args

				const next = [...args]
				next[payloadIndex] = { ...payload, content }
				return next
			} catch {
				return args
			}
		})

		cleanup(() => {
			patched.delete(original)
			unpatch()
		})
	} catch {
		patched.delete(original)
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
				withProps('sendMessage'),
				mod => install(mod, 'sendMessage', 1, cleanup),
				{ max: 5 },
			),
		)
		cleanup(
			getModules(
				withProps('editMessage'),
				mod => install(mod, 'editMessage', 2, cleanup),
				{ max: 5 },
			),
		)
		cleanup(
			getModules(
				withProps('_sendMessage'),
				mod => install(mod, '_sendMessage', 1, cleanup),
				{ max: 5 },
			),
		)
	},

	SettingsComponent,
})
