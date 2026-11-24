import { getModules, lookupModule } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	withName,
	withProps,
} from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
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

function debugStores(): void {
	const result = lookupModule(withProps('getUsers')) as unknown
	const target = Array.isArray(result) ? result[0] : result
	console.log('[ReactionLogger] userStore', JSON.stringify(methodNames(target)))

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
		debugStores()
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
