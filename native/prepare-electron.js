// Build-time vendor archive extraction. Never starts Electron or the installed GUI.
const fs = require( 'node:fs' )
const path = require( 'node:path' )
const { execFileSync } = require( 'node:child_process' )
const { downloadArtifact } = require( '../app/node_modules/@electron/get' )
const root = path.resolve( __dirname, '..' )
const electronRoot = path.join( root, 'app/node_modules/electron' )
async function main() {
    const dist = path.join( electronRoot, 'dist' )
    if( fs.existsSync( path.join( dist, 'Electron.app/Contents/Info.plist' ) ) &&
        fs.existsSync( path.join( dist, 'Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework' ) ) ) return
    const { version } = require( path.join( electronRoot, 'package.json' ) )
    const archive = await downloadArtifact( {
        version, artifactName: 'electron', platform: 'darwin', arch: 'arm64',
        cacheRoot: path.join( root, 'build/electron-cache' ),
        checksums: require( path.join( electronRoot, 'checksums.json' ) )
    } )
    fs.mkdirSync( dist, { recursive: true } )
    // Stock ditto preserves framework symlinks and completes extraction on this host.
    execFileSync( '/usr/bin/ditto', [ '-x', '-k', archive, dist ] )
    fs.writeFileSync( path.join( electronRoot, 'path.txt' ), 'Electron.app/Contents/MacOS/Electron' )
}
main().catch( error => { console.error( error ); process.exitCode = 1 } )
