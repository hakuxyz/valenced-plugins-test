import { clampRaise, pillTop, RAISE_LIMIT } from './shared'

function check(name: string, actual: number, expected: number): void {
	if (actual !== expected)
		throw new Error(`${name}: got ${actual}, want ${expected}`)
}

check('default sits directly above the box', pillTop(24, 2, 6, 0), -34)
check('raise moves the pill up', pillTop(24, 2, 6, 48), -82)
check('raise is clamped at the limit', clampRaise(999), RAISE_LIMIT)
check('negative raise is clamped to zero', clampRaise(-5), 0)
check('bad input falls back to zero', clampRaise(Number.NaN), 0)
