'use strict'

const assert = require('assert')
const fs = require('fs')
const Module = require('module')
const os = require('os')
const path = require('path')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blitzmax-workspace-sdk-'))
const sdkA = path.join(root, 'sdk-a')
const sdkB = path.join(root, 'sdk-b')

function createSdk(sdk, name) {
	const commandsDir = path.join(sdk, 'docs', 'html', 'Modules')
	const moduleDir = path.join(sdk, 'mod', 'test.mod', name.toLowerCase() + '.mod')
	const binDir = path.join(sdk, 'bin')
	fs.mkdirSync(commandsDir, { recursive: true })
	fs.mkdirSync(moduleDir, { recursive: true })
	fs.mkdirSync(binDir, { recursive: true })
	fs.writeFileSync(path.join(binDir, 'bmk'), '')
	fs.writeFileSync(path.join(commandsDir, 'commands.txt'), `${name}|/mod/test.mod/${name.toLowerCase()}.mod/doc/commands.html\n`)
	fs.writeFileSync(path.join(moduleDir, name.toLowerCase() + '.bmx'), '')
}

createSdk(sdkA, 'Alpha')
createSdk(sdkB, 'Beta')

const folderA = { uri: { fsPath: path.join(root, 'project-a') } }
const folderB = { uri: { fsPath: path.join(root, 'project-b') } }
let editorChanged
const vscode = {
	EventEmitter: class {
		constructor() {
			this.listeners = []
			this.event = listener => { this.listeners.push(listener); return { dispose() {} } }
		}
		fire() { this.listeners.forEach(listener => listener()) }
		dispose() {}
	},
	MarkdownString: class { appendCodeblock() {} appendMarkdown() {} },
	Uri: { file: fsPath => ({ fsPath }) },
	commands: { registerCommand: () => ({ dispose() {} }), executeCommand: () => Promise.resolve() },
	window: {
		activeTextEditor: { document: { uri: { fsPath: path.join(folderA.uri.fsPath, 'main.bmx') } } },
		onDidChangeActiveTextEditor: listener => { editorChanged = listener; return { dispose() {} } }
	},
	workspace: {
		workspaceFolders: [folderA, folderB],
		getWorkspaceFolder: uri => uri.fsPath.startsWith(folderA.uri.fsPath) ? folderA : folderB,
		getConfiguration: (_, folder) => ({ get: () => folder === folderA ? sdkA : folder === folderB ? sdkB : sdkA }),
		onDidChangeConfiguration: () => ({ dispose() {} })
	}
}

const originalLoad = Module._load
Module._load = function(request, parent, isMain) {
	if (request === 'vscode') return vscode
	if (request === './lsp') return {}
	return originalLoad.apply(this, arguments)
}

try {
	const helper = require('../out/helper')
	const docs = require('../out/bmxdocs')
	assert.strictEqual(helper.getBlitzMaxPathForDocument({ uri: { fsPath: path.join(folderA.uri.fsPath, 'main.bmx') } }), sdkA)
	assert.strictEqual(helper.getBlitzMaxPathForDocument({ uri: { fsPath: path.join(folderB.uri.fsPath, 'main.bmx') } }), sdkB)
	const context = { subscriptions: [] }
	helper.registerHelperGuide(context)
	docs.registerDocsProvider(context)

	assert.deepStrictEqual(docs.getCommand().map(cmd => cmd.realName), ['Alpha'])
	assert.deepStrictEqual(docs.getModule().map(mod => mod.name), ['test.alpha'])

	vscode.window.activeTextEditor = { document: { uri: { fsPath: path.join(folderB.uri.fsPath, 'main.bmx') } } }
	editorChanged(vscode.window.activeTextEditor)
	assert.deepStrictEqual(docs.getCommand().map(cmd => cmd.realName), ['Beta'])
	assert.deepStrictEqual(docs.getModule().map(mod => mod.name), ['test.beta'])

	vscode.window.activeTextEditor = { document: { uri: { fsPath: path.join(folderA.uri.fsPath, 'main.bmx') } } }
	editorChanged(vscode.window.activeTextEditor)
	assert.deepStrictEqual(docs.getCommand().map(cmd => cmd.realName), ['Alpha'])
	console.log('Workspace SDK documentation selection passed')
} finally {
	Module._load = originalLoad
	fs.rmSync(root, { recursive: true, force: true })
}
