'use strict'

import * as vscode from 'vscode'
import * as path from 'path'
import { existsSync } from './common'
import { cacheCommandsAndModulesIfEmpty } from './bmxdocs'

export let BlitzMaxPath: string | undefined
const blitzMaxPathChanged = new vscode.EventEmitter<void>()
export const onBlitzMaxPathChanged = blitzMaxPathChanged.event

export function getBlitzMaxPathForDocument( document?: vscode.TextDocument ): string | undefined {
	const folder = document ? vscode.workspace.getWorkspaceFolder( document.uri ) : undefined
	if ( folder ) return vscode.workspace.getConfiguration( 'blitzmax', folder ).get<string>( 'base.path' )

	// A single open folder is also the workspace when no editor is active yet.
	const folders = vscode.workspace.workspaceFolders
	if ( !document && folders?.length === 1 )
		return vscode.workspace.getConfiguration( 'blitzmax', folders[0] ).get<string>( 'base.path' )

	const defaultPath = vscode.workspace.getConfiguration( 'blitzmax' ).get<string>( 'base.path' )
	if ( defaultPath || document ) return defaultPath
	// With no active editor and no shared default, show docs for the first
	// folder that has an SDK instead of prompting to configure a global one.
	for ( const workspaceFolder of folders || [] ) {
		const folderPath = vscode.workspace.getConfiguration( 'blitzmax', workspaceFolder ).get<string>( 'base.path' )
		if ( folderPath ) return folderPath
	}
	return undefined
}

function updateBlitzMaxPath( document?: vscode.TextDocument ) {
	const nextPath = getBlitzMaxPathForDocument( document )
	if ( BlitzMaxPath === nextPath ) return
	BlitzMaxPath = nextPath
	blitzMaxPathChanged.fire()
}
const bmxNoPathMessage = `No BlitzMax path configured!

The BlitzMax extension needs to know your BlitzMax location.
Please select the root of your BlitzMax folder.

This can be changed in settings later.`

export function registerHelperGuide( context: vscode.ExtensionContext ) {
	context.subscriptions.push( blitzMaxPathChanged )

	// Make sure we know the BlitzMax path
	updateBlitzMaxPath( vscode.window.activeTextEditor?.document )
	context.subscriptions.push( vscode.window.onDidChangeActiveTextEditor( editor => {
		if ( editor ) updateBlitzMaxPath( editor.document )
	} ) )
	vscode.workspace.onDidChangeConfiguration( ( event ) => {
		if ( event.affectsConfiguration( 'blitzmax.base.path' ) ) {
			updateBlitzMaxPath( vscode.window.activeTextEditor?.document )
			triggerBmxInstallHelp()
		}
	} )
	
	
	// Open BlitzMax settings
	context.subscriptions.push( vscode.commands.registerCommand( 'blitzmax.settings', () => {
		vscode.commands.executeCommand( 'workbench.action.openSettings', '@ext:hezkore.blitzmax' )
	} ) )
	
	// Visit BlitzMax.org command
	context.subscriptions.push( vscode.commands.registerCommand( 'blitzmax.homepage', () => {
		vscode.env.openExternal( vscode.Uri.parse( 'https://blitzmax.org/') )
	} ) )

	// Quick command to picking a BlitzMax path
	context.subscriptions.push( vscode.commands.registerCommand( 'blitzmax.pickBlitzMaxPath', () => {
		vscode.window.showOpenDialog( {
			title: 'Select your BlitzMax root path', openLabel: 'Select',
			canSelectFiles: false, canSelectFolders: true, canSelectMany: false
		} ).then( async ( picked: vscode.Uri[] | undefined ) => {
			if ( picked && picked[0] ) {

				// Make sure the picked path actually is root
				if ( existsSync( picked[0].fsPath + '/bin/bmk' ) ) {
					await vscode.workspace.getConfiguration( 'blitzmax' ).update( 'base.path', picked[0].fsPath, true )
				} else {
					const altPath = path.resolve( picked[0].fsPath, '..' )
					if ( existsSync( altPath + '/bin/bmk' ) ) {
						await vscode.workspace.getConfiguration( 'blitzmax' ).update( 'base.path', altPath, true )
					}
				}

				// Notify if the path was set
				if ( vscode.workspace.getConfiguration( 'blitzmax' ).get( 'base.path' ) ) {
					vscode.window.showInformationMessage( 'BlitzMax path set' )
				} else {
					vscode.window.showErrorMessage( '"bin/bmk" was not found', 'Select path' ).then( picked => {
						if ( picked ) vscode.commands.executeCommand( 'blitzmax.pickBlitzMaxPath' )
					} )
				}
			}
		} )
	} ) )

	// Quick command to picking the BlitzMax formatter path
	context.subscriptions.push( vscode.commands.registerCommand( 'blitzmax.pickBlitzMaxFormatterPath', () => {
		vscode.window.showOpenDialog( {
			title: 'Select your BlitzMax formatter executable', openLabel: 'Select',
			canSelectFiles: true, canSelectFolders: false, canSelectMany: false
		} ).then( async ( picked: vscode.Uri[] | undefined ) => {
			if ( picked && picked[0] ) {

				await vscode.workspace.getConfiguration( 'blitzmax' ).update( 'formatter.path', picked[0].fsPath, true )
				vscode.window.showInformationMessage( 'BlitzMax formatter path set' )
			}
		} )
	} ) )

	triggerBmxInstallHelp()
}

// Anyone can write a formatter for BlitzMax NG, so this points at the GitHub topic
// rather than at any one of them
const FORMATTER_SEARCH: string = 'https://github.com/search?q=topic%3ABlitzMax+topic%3Aformatter&type=repositories'

// Help with BlitzMax external formatter
export function triggerBmxFormatterHelp() {

	vscode.window.showWarningMessage(
		'No BlitzMax formatter found. A formatter is a separate program, and dropping one into the bin folder of your BlitzMax NG install is enough for it to be picked up.',
		'Select Path',
		'Find One'
	).then( selection => {
		if ( selection ) {
			if ( selection === 'Find One' ) {

				vscode.env.openExternal( vscode.Uri.parse( FORMATTER_SEARCH ) )
			} else {

				// Pick path
				vscode.commands.executeCommand( 'workbench.action.openSettings', '@ext:hezkore.blitzmax formatter' )
				vscode.commands.executeCommand( 'blitzmax.pickBlitzMaxFormatterPath' )
			}
		}
	} )
}

// Help with BlitzMax install
function triggerBmxInstallHelp() {
	
	vscode.commands.executeCommand( 'setContext', 'blitzmax:ready', false )
	
	// Notify that no BlitzMax path is set
	if ( !BlitzMaxPath ) {
		vscode.window.showWarningMessage( bmxNoPathMessage, { modal: true }, 'Select path' ).then( picked => {
			if ( picked ) {
				vscode.commands.executeCommand( 'workbench.action.openSettings', '@ext:hezkore.blitzmax' )
				vscode.commands.executeCommand( 'blitzmax.pickBlitzMaxPath' )
			}
		} )
	} else {
		// Notify that the BlitzMax path is incorrect
		if ( !existsSync( BlitzMaxPath + '/bin/bmk' ) ) {
			BlitzMaxPath = undefined
			blitzMaxPathChanged.fire()
			vscode.window.showErrorMessage( 'The BlitzMax path is incorrect', 'Select path' ).then( picked => {
				if ( picked ) {
					vscode.commands.executeCommand( 'workbench.action.openSettings', '@ext:hezkore.blitzmax' )
					vscode.commands.executeCommand( 'blitzmax.pickBlitzMaxPath' )
				}
			} )
		} else {
			vscode.commands.executeCommand( 'setContext', 'blitzmax:ready', true )
			cacheCommandsAndModulesIfEmpty( true )
		}
	}
}
