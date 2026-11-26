import {
	getModules,
	lookupModule,
	waitForModules,
} from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { after, instead } from '@valenced/patcher'
import { getErrorStack } from '@valenced/utils/error'
import { Alert } from 'react-native'
import { clearLogs, getRemovers, interceptReactions } from './logger'
import { styleRow } from './rows'
import type { ReactionEmoji, RowManager } from './shared'

interface ViewArgs {
	messageId?: string
	emoji?: ReactionEmoji
	isSelectedBurst?: boolean
}

interface UserStore {
	getUser?: (
		id: string,
	) => { username?: string; globalName?: string } | undefined
}

function patchReactionView(
	cleanup: (...fns: Array<() => unknown>) => void,
): void {
	const found = lookupModule(withProps('getUsers')) as unknown
	const store = (Array.isArray(found) ? found[0] : found) as
		| UserStore
		| undefined

	cleanup(
		waitForModules(withProps('handleViewReactions'), exports => {
			cleanup(
				instead(
					exports as Record<
						'handleViewReactions',
						(...args: unknown[]) => unknown
					>,
					'handleViewReactions',
					(args, original) => {
						const options = args[0] as ViewArgs | undefined
						if (options?.messageId && options.emoji) {
							const entry = getRemovers(
								options.messageId,
								options.emoji,
								options.isSelectedBurst ? 1 : 0,
							).at(-1)
							const id = entry?.userId
							if (id) {
								const user = store?.getUser?.(id)
								Alert.alert(
									'Reaction removed',
									`Removed by ${user?.globalName ?? user?.username ?? id}`,
								)
							}
						}
						return original(...args)
					},
				),
			)
		}),
	)
}

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
		patchReactionView(cleanup)
	},
})
