import { getModules } from '@valenced/modules/finders'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { cloneElement } from 'react'
import type { ElementType, ReactElement } from 'react'

type Cleanup = (...fns: Array<() => unknown>) => void

const ANIMATION_PROPS: Record<string, unknown> = {
	paused: true,
	autoPlay: false,
	autoplay: false,
	shouldAnimate: false,
	shouldPlay: false,
	isPlaying: false,
	playing: false,
	animate: false,
	loop: false,
}

const HOST_MEDIA_TYPES = [
	'Image',
	'RCTImageView',
	'ImageView',
	'AnimatedImage',
	'GifView',
] as const

const logged = new Set<string>()
const patchedComponents = new Set<ElementType>()

function logOnce(key: string, ...args: unknown[]): void {
	if (logged.has(key)) return
	logged.add(key)
	try {
		console.log('[freeze-gif-picker]', ...args)
	} catch {}
}

function isRecord(value: unknown): value is Record<string, any> {
	return value !== null && typeof value === 'object'
}

function componentName(value: unknown): string {
	if (typeof value !== 'function' && !isRecord(value)) return ''
	const candidate = value as Record<string, any>
	return (
		candidate.displayName ??
		candidate.name ??
		(candidate.type && componentName(candidate.type)) ??
		''
	)
}

function isGifComponentName(name: string): boolean {
	return /gif/i.test(name)
}

function sourceInfo(props: Record<string, any>): unknown {
	const source =
		props.source ??
		props.imageSource ??
		props.imageUrl ??
		props.url ??
		props.uri

	if (typeof source === 'string') return source.slice(0, 220)

	if (Array.isArray(source)) {
		return source.slice(0, 2).map(item => sourceInfo({ source: item }))
	}

	if (isRecord(source)) {
		const uri = source.uri ?? source.url ?? source.src
		return typeof uri === 'string' ? uri.slice(0, 220) : Object.keys(source)
	}

	return undefined
}

function deanimateUri(uri: unknown): string | undefined {
	if (typeof uri !== 'string' || !/^https?:\/\//i.test(uri)) return undefined

	try {
		const url = new URL(uri)
		let changed = false

		if (url.searchParams.get('animated')?.toLowerCase() === 'true') {
			url.searchParams.set('animated', 'false')
			changed = true
		}

		const format = url.searchParams.get('format')?.toLowerCase()
		if (format === 'gif' || format === 'apng') {
			url.searchParams.set('format', 'png')
			changed = true
		}

		if (/\.gif(?:[?#]|$)/i.test(url.pathname)) {
			url.pathname = url.pathname.replace(/\.gif$/i, '.png')
			changed = true
		}

		return changed ? url.toString() : undefined
	} catch {
		if (/\.gif(?:[?#]|$)/i.test(uri)) {
			return uri.replace(/\.gif(?=[?#]|$)/i, '.png')
		}
		return undefined
	}
}

function freezeUri(value: unknown): unknown {
	if (typeof value === 'string') return deanimateUri(value) ?? value

	if (Array.isArray(value)) return value.map(item => freezeUri(item))

	if (isRecord(value)) {
		const uri = value.uri ?? value.url ?? value.src
		const next = deanimateUri(uri)
		if (!next || next === uri) return value

		const updated = { ...value }
		if ('uri' in updated) updated.uri = next
		if ('url' in updated) updated.url = next
		if ('src' in updated) updated.src = next
		return updated
	}

	return value
}

function freezeElement(
	element: ReactElement<Record<string, any>>,
	tag: string,
): ReactElement<Record<string, any>> {
	const props = element.props ?? {}
	const nextProps: Record<string, any> = { ...props }

	for (const [key, value] of Object.entries(ANIMATION_PROPS)) {
		if (key in nextProps && nextProps[key] !== value) nextProps[key] = value
	}

	for (const key of ['source', 'imageSource'] as const) {
		if (key in nextProps) {
			const frozen = freezeUri(nextProps[key])
			if (frozen !== nextProps[key]) nextProps[key] = frozen
		}
	}

	const originalSource = sourceInfo(props)
	const frozenSource = sourceInfo(nextProps)
	if (originalSource !== frozenSource) {
		logOnce(
			`${tag}:source`,
			`${tag} deanimated source`,
			originalSource,
			'->',
			frozenSource,
		)
	}

	return cloneElement(element, nextProps)
}

function installJsxHook(
	type: ElementType,
	tag: string,
	cleanup: Cleanup,
): void {
	if (patchedComponents.has(type)) return
	patchedComponents.add(type)

	try {
		const unpatch = afterJSX(type, element => {
			try {
				const props = (element as ReactElement<Record<string, any>>).props ?? {}
				logOnce(
					`${tag}:props`,
					`${tag} props`,
					Object.keys(props).sort(),
					sourceInfo(props),
				)
				return freezeElement(element as ReactElement<Record<string, any>>, tag)
			} catch {
				return element
			}
		})

		cleanup(() => {
			patchedComponents.delete(type)
			unpatch()
		})
	} catch {
		patchedComponents.delete(type)
	}
}

function collectGifComponents(
	value: unknown,
	output: Set<ElementType>,
	depth = 0,
): void {
	if (depth > 3 || (!isRecord(value) && typeof value !== 'function')) return

	const name = componentName(value)
	if (name && isGifComponentName(name)) output.add(value as ElementType)

	if (!isRecord(value) || depth >= 3) return
	for (const key of Object.keys(value)) {
		if (key === '_owner' || key === '_store' || key === '_self') continue
		try {
			collectGifComponents(value[key], output, depth + 1)
		} catch {}
	}
}

function hasGifHint(value: unknown, depth = 0): boolean {
	if (depth > 2 || (!isRecord(value) && typeof value !== 'function'))
		return false
	if (isGifComponentName(componentName(value))) return true
	if (!isRecord(value)) return false

	return Object.keys(value).some(key => {
		if (key === '_owner' || key === '_store' || key === '_self') return false
		if (/gif/i.test(key)) return true
		try {
			return hasGifHint(value[key], depth + 1)
		} catch {
			return false
		}
	})
}

function patchGifComponents(cleanup: Cleanup): void {
	try {
		cleanup(
			getModules(
				(moduleExports: unknown) => hasGifHint(moduleExports),
				(moduleExports: unknown) => {
					const found = new Set<ElementType>()
					collectGifComponents(moduleExports, found)
					for (const component of found) {
						installJsxHook(component, componentName(component), cleanup)
					}
				},
				{ returnNamespace: true },
			),
		)
	} catch {}
}

export default plugin({
	start({ cleanup }) {
		for (const type of HOST_MEDIA_TYPES) {
			installJsxHook(type as ElementType, `host:${type}`, cleanup)
		}
		patchGifComponents(cleanup)
		logOnce('started', 'freeze-gif-picker active (afterJSX)')
	},
})
