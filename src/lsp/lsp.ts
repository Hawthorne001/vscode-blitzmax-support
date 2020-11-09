'use strict'

import * as vscode from 'vscode'
import * as lsp from 'vscode-languageclient'
//import * as url from 'url'
//import * as os from 'os'

let outputChannel: vscode.OutputChannel
let activeBmxLsp: BmxLsp | undefined
let defaultBmxLsp: BmxLsp | undefined
let runningBmxLsps: Map<string, BmxLsp> = new Map()

let _sortedWorkspaceFolders: string[] | undefined
function sortedWorkspaceFolders(): string[] {
	if (_sortedWorkspaceFolders === void 0) {
		_sortedWorkspaceFolders = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.map(folder => {
			let result = folder.uri.toString()
			if (result.charAt(result.length - 1) !== '/') {
				result = result + '/'
			}
			return result
		}).sort(
			(a, b) => {
				return a.length - b.length
			}
		) : []
	}
	return _sortedWorkspaceFolders
}
vscode.workspace.onDidChangeWorkspaceFolders(() => _sortedWorkspaceFolders = undefined)

function getOuterMostWorkspaceFolder(folder: vscode.WorkspaceFolder | undefined): vscode.WorkspaceFolder | undefined {
	if (!folder) return undefined
	let sorted = sortedWorkspaceFolders()
	for (let element of sorted) {
		let uri = folder.uri.toString()
		if (uri.charAt(uri.length - 1) !== '/') {
			uri = uri + '/'
		}
		if (uri.startsWith(element)) {
			return vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(element))!
		}
	}
	return folder
}

export function registerBmxLsp(context: vscode.ExtensionContext) {
	
	outputChannel = vscode.window.createOutputChannel('BlitzMax Language Server')
	
	// Start LSP for each document with unique workspace
	changeBmxDocument(vscode.window.activeTextEditor?.document)
	vscode.window.onDidChangeActiveTextEditor((event) => {
		changeBmxDocument(event?.document)
	})
	
	// Reset LSPs when settings change
	vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration( 'blitzmax.path' )) restartLsps()
	})
	
	// Remove LSPs for removed folders
	vscode.workspace.onDidChangeWorkspaceFolders((event) => {
		for (let folder of event.removed) {
			let bmxLsp = runningBmxLsps.get(folder.uri.toString())
			if (bmxLsp) {
				runningBmxLsps.delete(folder.uri.toString())
				bmxLsp.client.stop()
			}
		}
	})
}

export function deactivateLsp(): Thenable<void> {
	let promises: Thenable<void>[] = []
	for (let bmxLsp of runningBmxLsps.values()) {
		promises.push(bmxLsp.client.stop())
	}
	return Promise.all(promises).then(() => undefined)
}

function changeBmxDocument(document: vscode.TextDocument | undefined) {
	if (!document || document.languageId != "blitzmax") return
	activateBmxLsp(
		getOuterMostWorkspaceFolder(
			vscode.workspace.getWorkspaceFolder(document.uri)
		)
	)
	
	if (activeBmxLsp) {
		//console.log("Using LSP " + activeBmxLsp.workspace?.name)
	} else {
		//console.log("Not using any LSP")
	}
}

function activateBmxLsp(workspace: vscode.WorkspaceFolder | undefined): BmxLsp {
	// Do we have an active LSP?
	if (activeBmxLsp) {
		// Is it the same LSP?
		if (activeBmxLsp.workspace === workspace) {
			// Yep!
			return activeBmxLsp
		} else {
			// Nope!
			activeBmxLsp.pause()
			activeBmxLsp = undefined
		}
	}
	
	// Try to find an existing LSP for this workspace
	let existingBmxLsp: BmxLsp | undefined
	if (workspace) {
		existingBmxLsp = runningBmxLsps.get(workspace.uri.toString())
	} else {
		existingBmxLsp = defaultBmxLsp
	}
	
	// Did we find one?
	if (existingBmxLsp) {
		// Yep!
		activeBmxLsp = existingBmxLsp
		existingBmxLsp.resume()
		return activeBmxLsp
	}
	
	// Start a new LSP
	existingBmxLsp = new BmxLsp( workspace )
	
	// Where do we store this?
	if (!workspace) {
		defaultBmxLsp = existingBmxLsp
	} else {
		runningBmxLsps.set(workspace.uri.toString(), existingBmxLsp)
	}
	
	// Make this our active LSP
	activeBmxLsp = existingBmxLsp
	return activeBmxLsp
}

function restartLsps() {
	activeBmxLsp = undefined
	
	if (defaultBmxLsp) {
		if (defaultBmxLsp.client) defaultBmxLsp.client.stop()
		defaultBmxLsp = undefined
	}
	
	runningBmxLsps.forEach(bmxLsp => {
		if (bmxLsp.client) bmxLsp.client.stop()
	})
	runningBmxLsps.clear()
}

class BmxLsp {
	
	name: string = "Unknown"
	workspace: vscode.WorkspaceFolder | undefined
	clientOptions: lsp.LanguageClientOptions
	client: lsp.LanguageClient
	
	_started: boolean
	
	pause() {
		if (this.client && this._started) {
			this.client.sendNotification('$pause',{state:true})
			this._started = false
		}
	}
	
	resume() {
		if (this.client && !this._started) {
			this.client.sendNotification('$pause',{state:false})
			this._started = true
		}
	}
	
	constructor(workspace: vscode.WorkspaceFolder | undefined) {
		this.workspace = workspace
		
		// Setup client
		this.clientOptions = {
			diagnosticCollectionName: 'bmx-lsp',
			outputChannel: outputChannel
		}
		
		if (workspace) {
			// For a proper workspace, we send everything
			this.clientOptions.documentSelector = [
				{ scheme: 'file', language: 'blitzmax', pattern: `${workspace.uri.fsPath}/**/*` }
			]
			this.clientOptions.workspaceFolder = workspace
		} else {
			// For files we know nothing about, we send nothing
			this.clientOptions.documentSelector = [
				{ scheme: 'file', language: 'blitzmax', pattern: '**' }
			]
			this.clientOptions.workspaceFolder = {uri: vscode.Uri.parse(''), name: '', index: -1}
		}
		
		// Figure out path to BlitzMax
		let bmxFolder: string | undefined
		
		if (this.workspace) {
			// If this is part of a workspace, we use that path
			bmxFolder = vscode.workspace.getConfiguration( 'blitzmax', this.workspace ).get( 'path' )
		} else {
			// If this is a separate unkown file, we use the default BlitzMax path
			let globalBmxPath = vscode.workspace.getConfiguration( 'blitzmax' ).inspect( 'path' )?.globalValue
			if (typeof(globalBmxPath)==='string') bmxFolder = globalBmxPath
		}
		
		let lspPath = vscode.Uri.file( bmxFolder + "/bin/lsp" )
		
		// Start the LSP
		this.client = new lsp.LanguageClient('BlitzMax Language Server',
			{ command: lspPath.fsPath, args: undefined, options: { env: undefined } },
			this.clientOptions
		)
		this.client.start()
		this._started = true
	}
}