import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
	withProps,
} from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { currentColors, currentUserId } from './colors'
import type { AnyFunction } from '@valenced/utils/types'

type Cleanup = (...unpatches: Array<() => boolean | void>) => void

type Instead = (args: unknown[], original: AnyFunction) => unknown

const insteadLoose = instead as unknown as (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: Instead,
) => () => boolean

/**
 * Matches a module that exposes a function either directly, as a named
 * export, or as its default export.
 */
const withFunctionName = createFilterGenerator<[name: string]>(
	([name], _id, exports) => {
		if (typeof exports === 'function') return exports.name === name
		if (typeof exports !== 'object' || exports === null) return false

		const record = exports as Record<string, unknown>
		if (typeof record[name] === 'function') return true

		return typeof record.default === 'function' && record.default.name === name
	},
	([name]) => `valenced.functionName(${name})`,
	FilterScopes.Initialized,
)

let getProfileTheme: ((color: number) => unknown) | undefined

function isOwnUser(user: unknown) {
	if (typeof user !== 'object' || user === null) return false

	const id = (user as { id?: unknown }).id
	const ownId = currentUserId()
	return ownId != null && id === ownId
}

function applyThemePreview(result: unknown) {
	const colors = currentColors()
	if (!colors || typeof result !== 'object' || result === null) return

	const theme = result as {
		theme?: unknown
		primaryColor?: number | null
		secondaryColor?: number | null
	}

	theme.primaryColor = colors[0]
	theme.secondaryColor = colors[1]
	if (getProfileTheme) theme.theme = getProfileTheme(colors[0])
}

function createThemeHook(): Instead {
	return (args, original) => {
		const result = original(...args)

		try {
			const options = args[0]
			if (typeof options !== 'object' || options === null) return result

			const record = options as {
				user?: unknown
				pendingThemeColors?: unknown
			}
			const editorPreview = 'pendingThemeColors' in record
			if (!editorPreview && !isOwnUser(record.user)) return result

			applyThemePreview(result)
		} catch {}

		return result
	}
}

function createThemeColorsHook(): Instead {
	return (args, original) => {
		const result = original(...args)

		try {
			const user = args[0]
			const previewProps = args[2]
			if (!previewProps && !isOwnUser(user)) return result

			const colors = currentColors()
			if (!colors || !Array.isArray(result)) return result

			return [colors[0], colors[1]]
		} catch {}

		return result
	}
}

function patchHook(cleanup: Cleanup, name: string, createHook: () => Instead) {
	cleanup(
		getModules(
			withFunctionName(name),
			module => {
				try {
					const record = module as Record<string, unknown> | undefined
					if (!record) return

					const hook = createHook()

					if (typeof record[name] === 'function') {
						cleanup(
							insteadLoose(record as Record<string, AnyFunction>, name, hook),
						)
					}

					if (record.default !== record[name]) {
						const fallback = record.default
						if (typeof fallback === 'function' && fallback.name === name) {
							cleanup(
								insteadLoose(
									record as Record<string, AnyFunction>,
									'default',
									hook,
								),
							)
						}
					}
				} catch {}
			},
			{ max: 3, returnNamespace: true },
		),
	)
}

export function setupThemePreview(cleanup: Cleanup) {
	cleanup(
		getModules(
			withProps('getProfileTheme'),
			module => {
				const record = module as {
					getProfileTheme?: unknown
					default?: { getProfileTheme?: unknown }
				}
				const fn = record?.getProfileTheme ?? record?.default?.getProfileTheme
				if (typeof fn === 'function') {
					getProfileTheme = fn as (color: number) => unknown
				}
			},
			{ max: 1, returnNamespace: true },
		),
	)

	patchHook(cleanup, 'useProfileTheme', createThemeHook)
	patchHook(cleanup, 'useProfileThemeColors', createThemeColorsHook)
}
