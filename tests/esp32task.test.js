'use strict'

const assert = require('assert')
const fs = require('fs')
const Module = require('module')
const os = require('os')
const path = require('path')

const vscode = {
	CustomExecution: class { constructor(callback) { this.callback = callback } },
	Task: class {
		constructor(definition, scope, name, source, execution) {
			this.definition = definition
			this.execution = execution
			this.presentationOptions = {}
		}
	},
	EventEmitter: class { constructor() { this.event = () => {} } },
	TaskScope: { Workspace: 1 },
	TaskPanelKind: { Shared: 1 },
	TaskRevealKind: { Silent: 1 },
	Uri: { file: fsPath => ({ fsPath }) },
	window: {},
	workspace: { getWorkspaceFolder: () => undefined, getConfiguration: () => ({ get: () => undefined }), workspaceFolders: undefined }
}

const originalLoad = Module._load
Module._load = function(request, parent, isMain) {
	if (request === 'vscode') return vscode
	return originalLoad.apply(this, arguments)
}
let makeTask
let toggleBuildOptions
try {
	makeTask = require('../out/taskprovider').makeTask
	toggleBuildOptions = require('../out/buildtree').toggleBuildOptions
} finally {
	Module._load = originalLoad
}

async function argsFor(definition) {
	const task = makeTask(definition)
	const terminal = await task.execution.callback(definition)
	return terminal.args
}

async function main() {
	const base = {
		type: 'bmx', label: 'ESP32 test', make: 'application', apptype: 'console',
		target: 'esp32', source: '/tmp/hello.bmx', output: '/tmp/hello', bmk: '/sdk/bin/bmk'
	}
	const args = await argsFor({
		...base, architecture: 'riscv32', esp32Board: 'baguette_c3',
		esp32Heap: '128KiB', esp32HeapRegion: 'sram', esp32Upload: true,
		noAutoSuperStrict: true, gprof: true, threaded: true
	})
	assert.deepStrictEqual(args, [
		'makeapp', '-r', '-l', 'esp32', '-g', 'riscv32', '-nas',
		'-board', 'baguette_c3', '-heap', '128KiB', '-heap-region', 'sram', '-x',
		'-t', 'console', '-o', '/tmp/hello', '/tmp/hello.bmx'
	])
	const withoutBoard = await argsFor({ ...base, architecture: 'xtensa' })
	assert(withoutBoard.includes('xtensa'))
	assert(!withoutBoard.includes('-board'))
	const advanced = await toggleBuildOptions({ ...base }, 'adv_no_auto_superstrict')
	assert.strictEqual(advanced.noAutoSuperStrict, true)
	const folderA = { uri: { fsPath: '/projects/a' } }
	const folderB = { uri: { fsPath: '/projects/b' } }
	vscode.workspace.getWorkspaceFolder = uri => uri.fsPath.startsWith('/projects/a/') ? folderA : folderB
	vscode.workspace.getConfiguration = (_, folder) => ({ get: () => folder === folderA ? '/sdk/a' : '/sdk/b' })
	const taskA = makeTask({ ...base, bmk: undefined, source: '/projects/a/main.bmx' })
	const taskB = makeTask({ ...base, bmk: undefined, source: '/projects/b/main.bmx' })
	assert.strictEqual((await taskA.execution.callback(taskA.definition)).cmd, '/sdk/a/bin/bmk')
	assert.strictEqual((await taskB.execution.callback(taskB.definition)).cmd, '/sdk/b/bin/bmk')

	const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'blitzmax-esp32-picker-'))
	try {
		const boardDir = path.join(temporary, 'mod', 'esp32.mod', 'boards', 'my_c3')
		fs.mkdirSync(boardDir, { recursive: true })
		fs.writeFileSync(path.join(boardDir, 'board.ini'), 'format=1\n[board]\nname=My C3\ntarget=esp32c3\n')
		vscode.workspace.getConfiguration = () => ({ get: () => temporary })
		vscode.window.showQuickPick = async choices => choices.find(choice => choice.profile?.id === 'my_c3')
		const selected = await toggleBuildOptions({ ...base, architecture: 'xtensa' }, 'esp32_board')
		assert.strictEqual(selected.esp32Board, 'my_c3')
		assert.strictEqual(selected.architecture, 'riscv32')
		const switched = await toggleBuildOptions({ ...base, target: 'win32', architecture: 'x64', esp32Board: 'my_c3' }, 'plat_esp32')
		assert.strictEqual(switched.architecture, 'riscv32')
		assert.strictEqual(switched.apptype, 'console')
	} finally {
		fs.rmSync(temporary, { recursive: true, force: true })
	}
	console.log('ESP32 build task arguments passed')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
