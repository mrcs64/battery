const path = require( 'node:path' )
const { execFile } = require( 'node:child_process' )
const { promisify } = require( 'node:util' )
const run = promisify( execFile )
// Packaged outside ASAR; development builds use the same compiled read-only probe.
const probe_path = () => process.resourcesPath ? path.join( process.resourcesPath, 'charging-override' ) : path.resolve( __dirname, '../../build/charging-override' )
const parse_override = text => {
    try {
        const value = JSON.parse( text )
        return value.version === 1 && [ 0, 1 ].includes( value.override ) ? value.override : null
    } catch {
        return null
    }
}
const read_override = async ( runner = run, executable = probe_path() ) => {
    try {
        const { stdout } = await runner( executable, [], { timeout: 5000, maxBuffer: 4096 } )
        return parse_override( stdout )
    } catch {
        return null
    }
}
const override_status = ( limit, state ) => ( {
    override_state: state,
    // A configured request is not proof of effective enforcement.
    limiter_active: Boolean( limit ) && state === 0,
    override_message: state === 1 ? 'Temporarily overridden by macOS — charging to full' :
        state === 0 ? 'macOS full-charge override: not reported' : 'macOS full-charge override: status unavailable',
    override_detail: state === 1 ? 'macOS may charge fully for battery gauge maintenance; the signal does not identify the reason.' :
        'The configured limit is a request; physical enforcement is not verified.'
} )
module.exports = { parse_override, read_override, override_status }
