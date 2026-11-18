export interface Settings {
	showSeconds: boolean
	showLabel: boolean
}

export const DefaultSettings: Settings = {
	showSeconds: true,
	showLabel: true,
}

export interface TimeoutInfo {
	id?: string
	channelId?: string
	guildId: string
	authorId: string
	deadline: number
}

export function toTimestamp(value: unknown): number {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : Number.NaN
	}
	if (value instanceof Date) return value.getTime()
	if (typeof value === 'string' && value.trim()) {
		const numeric = Number(value)
		return Number.isFinite(numeric) ? numeric : Date.parse(value)
	}
	return Number.NaN
}

export function formatRemaining(ms: number, showSeconds: boolean): string {
	const total = Math.max(1, Math.ceil(ms / 1000))
	const parts: string[] = []

	if (showSeconds) {
		const days = Math.floor(total / 86400)
		const hours = Math.floor((total % 86400) / 3600)
		const minutes = Math.floor((total % 3600) / 60)
		const seconds = total % 60

		if (days) parts.push(`${days}d`)
		if (hours) parts.push(`${hours}h`)
		if (minutes || days || hours) parts.push(`${minutes}m`)
		parts.push(`${seconds}s`)
	} else {
		const minutes = Math.ceil(total / 60)
		const days = Math.floor(minutes / 1440)
		const hours = Math.floor((minutes % 1440) / 60)
		const rest = minutes % 60

		if (days) parts.push(`${days}d`)
		if (hours) parts.push(`${hours}h`)
		if (rest) parts.push(`${rest}m`)
	}

	return parts.join(' ') || '1m'
}
