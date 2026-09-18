'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { esp32TargetArchitecture, loadEsp32BoardProfiles } = require('../out/esp32boards')

assert.strictEqual(esp32TargetArchitecture('esp32s3'), 'xtensa')
assert.strictEqual(esp32TargetArchitecture('esp32c3'), 'riscv32')
assert.strictEqual(esp32TargetArchitecture('esp32c6'), 'riscv32')
assert.strictEqual(esp32TargetArchitecture('unknown'), undefined)

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'blitzmax-esp32-boards-'))
const previousBoardDirs = process.env.ESP32_BOARD_DIRS
try {
	const bundled = path.join(temporary, 'mod', 'esp32.mod', 'boards', 'esp32')
	const customRoot = path.join(temporary, 'custom')
	const custom = path.join(customRoot, 'my_c3')
	fs.mkdirSync(bundled, { recursive: true })
	fs.mkdirSync(custom, { recursive: true })
	fs.writeFileSync(path.join(bundled, 'board.ini'), 'format=1\n[board]\nname=Generic ESP32\ntarget=esp32\n')
	fs.writeFileSync(path.join(custom, 'board.ini'), 'format=1\n[board]\nname=My C3\ntarget=esp32c3\n')
	process.env.ESP32_BOARD_DIRS = customRoot
	assert.deepStrictEqual(loadEsp32BoardProfiles(temporary), [
		{ id: 'esp32', name: 'Generic ESP32', target: 'esp32', architecture: 'xtensa' },
		{ id: 'my_c3', name: 'My C3', target: 'esp32c3', architecture: 'riscv32' }
	])
} finally {
	if (previousBoardDirs === undefined) delete process.env.ESP32_BOARD_DIRS
	else process.env.ESP32_BOARD_DIRS = previousBoardDirs
	fs.rmSync(temporary, { recursive: true, force: true })
}

console.log('ESP32 board profile discovery passed')
