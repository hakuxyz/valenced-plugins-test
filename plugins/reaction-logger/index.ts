import { getModules, lookupModule } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import { getErrorStack } from '@valenced/utils/error'
import { clearLogs, interceptReactions } from './logger'
import { styleRow } from './rows'
import type { RowManager } from './shared'

function debugStores(): void {
	for (const props of [
		'getUsers',
		'getReactions',
		'getReactionUsers',
		'getUsersForReaction',
		'getUser',
	]) {
		const result = lookupModule(withProps(props)) as unknown
		const target = Array.isArray(result) ? result[0] : result
		const proto = target ? Object.getPrototypeOf(target) : undefined
		const protoKeys = proto ? Object.getOwnPropertyNames(proto) : []
		const own = target ? Object.keys(target) : []
		console.log(
			'[ReactionLogger] lookup',
			props,
			'type=',
			typeof target,
			'own=',
			JSON.stringify(own.slice(0, 8)),
			'proto=',
			JSON.stringify(protoKeys),
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
