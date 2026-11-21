import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import { getErrorStack } from '@valenced/utils/error'
import { clearLogs, interceptReactions } from './logger'
import { styleRow } from './rows'
import type { RowManager } from './shared'

export default plugin({
	start({ cleanup, plugin }) {
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
