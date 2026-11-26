import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { createElement } from 'react'
import { getRemovers } from './logger'
import type { FC, ReactElement, ReactNode } from 'react'
import type { ReactionEmoji } from './shared'

const { ActionSheet, ActionSheetRow } = Design
const RemoverKey = 'reaction-logger-removers'

type Element = ReactElement<{
	key?: string | null
	children?: ReactNode
	label?: unknown
}>

interface SheetProps {
	messageId?: string
	emoji?: ReactionEmoji
	isSelectedBurst?: boolean
}

interface UserStore {
	getUser?: (
		id: string,
	) => { username?: string; globalName?: string } | undefined
}

function findActionSheet(element: unknown): Element | undefined {
	if (!element || typeof element !== 'object') return
	if (Array.isArray(element)) {
		for (const child of element) {
			const found = findActionSheet(child)
			if (found) return found
		}
		return
	}
	const { type, props } = element as Element
	if (type === ActionSheet) return element as Element
	return findActionSheet(props?.children)
}

function typeName(value: unknown): string {
	if (typeof value === 'function')
		return (
			(value as { displayName?: string; name?: string }).displayName ??
			(value as { name?: string }).name ??
			'function'
		)
	return String(value)
}

function describe(node: unknown): unknown {
	if (!node || typeof node !== 'object') return typeof node
	const { type, props } = node as Element
	return {
		type: typeName(type),
		children: [props?.children]
			.flat()
			.filter(Boolean)
			.map(child => typeName((child as Element)?.type))
			.slice(0, 12),
	}
}

function addRemovers(tree: unknown, names: string[]): void {
	const sheet = findActionSheet(tree)
	if (!sheet) return

	const children = [sheet.props.children]
		.flat()
		.filter(Boolean)
		.filter(child => (child as Element)?.key !== RemoverKey)
	const rows = names.map(name =>
		createElement(ActionSheetRow, {
			key: name,
			label: `Removed by ${name}`,
			variant: 'danger',
			onPress: () => ActionSheetActionCreators.hideActionSheet(),
		}),
	)
	children.splice(
		Math.max(children.length - 1, 0),
		0,
		createElement(ActionSheetRow.Group, {
			key: RemoverKey,
			children: rows,
		}),
	)
	sheet.props.children = children
}

function addIfFound(
	tree: ReactElement,
	names: string[],
	onError: (error: unknown) => void,
): boolean {
	if (!findActionSheet(tree)) return false
	try {
		addRemovers(tree, names)
	} catch (error) {
		onError(error)
	}
	return true
}

function injectChildren(
	tree: ReactElement,
	names: string[],
	onError: (error: unknown) => void,
	depth: number,
): ReactElement {
	const props = tree.props as { children?: ReactNode } | undefined
	const children = [props?.children]
		.flat()
		.filter(Boolean)
		.map(child => inject(child as ReactElement, names, onError, depth))
	return createElement(tree.type as FC<Record<string, unknown>>, {
		...(tree.props as Record<string, unknown>),
		children,
		key: tree.key,
	})
}

// The reaction sheet renders through connected components before the real sheet.
function inject(
	tree: ReactElement,
	names: string[],
	onError: (error: unknown) => void,
	depth = 0,
): ReactElement {
	if (!tree || typeof tree !== 'object' || depth >= 6) return tree
	if (addIfFound(tree, names, onError)) return tree

	const Inner = tree.type as FC<Record<string, unknown>>
	if (typeof Inner === 'function') {
		const Wrapped = (props: Record<string, unknown>) => {
			const inner = Reflect.apply(Inner, undefined, [props]) as ReactElement
			if (addIfFound(inner, names, onError)) return inner
			console.log('[ReactionLogger] descend', typeName(Inner))
			return injectChildren(inner, names, onError, depth + 1)
		}
		return createElement(Wrapped, {
			...(tree.props as Record<string, unknown>),
			key: tree.key,
		})
	}
	return injectChildren(tree, names, onError, depth + 1)
}

export function patchReactionActionSheet(
	onError: (error: unknown) => void,
): () => void {
	const found = lookupModule(withProps('getUsers')) as unknown
	const store = (Array.isArray(found) ? found[0] : found) as
		| UserStore
		| undefined

	const Actions = ActionSheetActionCreators as unknown as Record<
		'openLazy',
		(...args: unknown[]) => unknown
	>
	return instead(Actions, 'openLazy', (args, original) => {
		const [sheet, key, props] = args as [
			Promise<{ default: FC<SheetProps> }>,
			string,
			SheetProps,
		]
		if (
			key !== 'MessageReactions' ||
			!props?.messageId ||
			!props.emoji ||
			typeof sheet?.then !== 'function'
		)
			return original(...args)

		const names = getRemovers(
			props.messageId,
			props.emoji,
			props.isSelectedBurst ? 1 : 0,
		)
			.map(entry => entry.userId)
			.filter((id): id is string => !!id)
			.map(id => {
				const user = store?.getUser?.(id)
				return user?.globalName ?? user?.username ?? id
			})
		if (!names.length) return original(...args)

		console.log('[ReactionLogger] removers', key, JSON.stringify(names))
		const wrapped = sheet.then(module => ({
			default: (sheetProps: SheetProps) => {
				const tree = Reflect.apply(module.default, undefined, [
					sheetProps,
				]) as ReactElement
				console.log(
					'[ReactionLogger] sheet tree',
					JSON.stringify(describe(tree)),
				)
				return inject(tree, names, onError)
			},
		}))
		return original(wrapped, key, props)
	})
}
