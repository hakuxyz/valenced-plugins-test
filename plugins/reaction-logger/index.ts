import {
	getModules,
	lookupModule,
	waitForModules,
} from '@valenced/modules/finders'
import {
	createFilterGenerator,
	withName,
	withProps,
} from '@valenced/modules/finders/filters'
import { after, instead } from '@valenced/patcher'
import { getErrorStack } from '@valenced/utils/error'
import { clearLogs, interceptReactions } from './logger'
import { styleRow } from './rows'
import type { RowManager } from './shared'

function methodNames(target: unknown): string[] {
	if (!target || typeof target !== 'object') return []
	const proto = Object.getPrototypeOf(target)
	return [
		...Object.keys(target),
		...(proto ? Object.getOwnPropertyNames(proto) : []),
	]
}

function exportNames(target: unknown): string[] {
	const names = methodNames(target)
	return typeof target === 'function' ? [target.name, ...names] : names
}

function summarize(value: unknown): unknown {
	if (value === null || typeof value !== 'object') return value
	if (Array.isArray(value)) return value.map(summarize).slice(0, 8)
	const out: Record<string, unknown> = {}
	for (const [key, item] of Object.entries(value).slice(0, 20)) {
		out[key] =
			typeof item === 'object' && item !== null
				? Object.keys(item).slice(0, 12)
				: item
	}
	return out
}

function debugStores(cleanup: (...fns: Array<() => unknown>) => void): void {
	const result = lookupModule(withProps('getUsers')) as unknown
	const target = Array.isArray(result) ? result[0] : result
	console.log('[ReactionLogger] userStore', JSON.stringify(methodNames(target)))

	const view = lookupModule(withProps('handleViewReactions')) as unknown
	const viewTarget = Array.isArray(view) ? view[0] : view
	console.log(
		'[ReactionLogger] viewModule',
		JSON.stringify(exportNames(viewTarget)),
	)
	for (const name of [
		'handleViewReactions',
		'handleViewPreviewReactions',
		'handleRemoveAllReactions',
	]) {
		const fn = (viewTarget as Record<string, unknown> | undefined)?.[name]
		if (typeof fn === 'function')
			console.log('[ReactionLogger] fn', name, fn.toString().slice(0, 900))
	}

	cleanup(
		waitForModules(withProps('handleViewReactions'), exports => {
			cleanup(
				instead(
					exports as Record<
						'handleViewReactions',
						(...a: unknown[]) => unknown
					>,
					'handleViewReactions',
					(args, original) => {
						console.log(
							'[ReactionLogger] view args',
							JSON.stringify(args.map(summarize)),
						)
						console.log(
							'[ReactionLogger] view source',
							original.toString().slice(0, 1400),
						)
						return original(...args)
					},
				),
			)
		}),
	)

	const content = lookupModule(withName('MessageReactionsContent')) as unknown
	const contentTarget = Array.isArray(content) ? content[0] : content
	if (typeof contentTarget === 'function')
		console.log(
			'[ReactionLogger] content',
			contentTarget.toString().slice(0, 900),
		)

	for (const [label, pattern] of [
		['reaction-users', /reaction.*user|user.*reaction/i],
		['reaction-fns', /reaction/i],
	] as const) {
		const filter = createFilterGenerator(
			(_args, _id, exports) => {
				try {
					return exportNames(exports).some(name => pattern.test(name))
				} catch {
					return false
				}
			},
			() => label,
		)

		getModules(
			filter(),
			exports => {
				const names = exportNames(exports).filter(name => pattern.test(name))
				console.log(
					'[ReactionLogger] scan',
					label,
					JSON.stringify(names.slice(0, 16)),
				)
			},
			{ max: 60 },
		)
	}
}

export default plugin({
	start({ cleanup, plugin }) {
		console.log('[ReactionLogger] start')
		debugStores(cleanup)
		cleanup(
			...interceptReactions(),
			clearLogs,
			// modules/messages/native/renderer/RowGenerator.tsx
			getModules(withName<RowManager>('RowManager'), ({ prototype }) => {
				cleanup(
					after(prototype, 'generate', row => {
						try {
							return styleRow(row)
						} catch (e) {
							plugin.reportError(
								`Failed to style logged reaction: ${getErrorStack(e)}`,
							)
							return row
						}
					}),
				)
			}),
		)
	},
})
