import * as fs from 'fs'
import * as path from 'path'

export interface Esp32BoardProfile {
	id: string
	name: string
	target: string
	architecture: 'xtensa' | 'riscv32'
}

export function esp32TargetArchitecture( target: string ): 'xtensa' | 'riscv32' | undefined {
	switch ( target.toLowerCase() ) {
		case 'esp32':
		case 'esp32s2':
		case 'esp32s3':
			return 'xtensa'
		case 'esp32c2':
		case 'esp32c3':
		case 'esp32c5':
		case 'esp32c6':
		case 'esp32h2':
		case 'esp32p4':
			return 'riscv32'
	}
}

function readBoard( root: string, id: string ): Esp32BoardProfile | undefined {
	try {
		const contents = fs.readFileSync( path.join( root, id, 'board.ini' ), 'utf8' )
		let section = ''
		let name = id
		let target = ''
		for ( const line of contents.split( /\r?\n/ ) ) {
			const heading = line.match( /^\s*\[([^\]]+)\]\s*$/ )
			if ( heading ) {
				section = heading[1].toLowerCase()
				continue
			}
			if ( section != 'board' ) continue
			const property = line.match( /^\s*([^#;=\s]+)\s*=\s*(.*?)\s*$/ )
			if ( !property ) continue
			if ( property[1] == 'name' ) name = property[2]
			if ( property[1] == 'target' ) target = property[2]
		}
		const architecture = esp32TargetArchitecture( target )
		if ( architecture ) return { id, name, target, architecture }
	} catch ( error ) {
		// An absent or incomplete board profile should not break the picker.
	}
}

export function loadEsp32BoardProfiles( sdkPath: string | undefined ): Esp32BoardProfile[] {
	const roots: string[] = []
	if ( sdkPath ) roots.push( path.join( sdkPath, 'mod', 'esp32.mod', 'boards' ) )
	if ( process.env.ESP32_BOARD_DIRS ) roots.push( ...process.env.ESP32_BOARD_DIRS.split( path.delimiter ) )
	const profiles = new Map<string, Esp32BoardProfile>()
	for ( const root of roots ) {
		try {
			for ( const entry of fs.readdirSync( root, { withFileTypes: true } ) ) {
				if ( !entry.isDirectory() ) continue
				const profile = readBoard( root, entry.name )
				if ( profile ) profiles.set( profile.id, profile )
			}
		} catch ( error ) {
			// Keep the custom-name entry available when no SDK is configured.
		}
	}
	return [...profiles.values()].sort( ( a, b ) => a.id == 'esp32' ? -1 : b.id == 'esp32' ? 1 : a.id.localeCompare( b.id ) )
}
