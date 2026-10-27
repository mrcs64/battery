const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const vm = require( 'node:vm' )
const fs = require( 'node:fs' )
const source = fs.readFileSync( 'app/modules/battery.js', 'utf8' )
function load( result = '75,1:20,enabled,not discharging,60', failure ) {
    const calls = []
    const module = { exports: {} }
    const execFile = ( path, args, options, callback ) => {
        calls.push( { path, args, options } )
        callback( failure, result, '' )
    }
    execFile[ require( 'node:util' ).promisify.custom ] = async ( path, args, options ) => {
        calls.push( { path, args, options } )
        if( failure ) throw failure
        return { stdout: result, stderr: '' }
    }
    vm.runInNewContext( source, { module, require: name => name === 'node:child_process' ? { execFile } : require( name ) } )
    return { api: module.exports, calls }
}
test( 'startup reads status once without enabling/updating/killing/installing', async () => {
    const { api, calls } = load()
    const status = await api.initialize_battery()
    assert.equal( status.maintain_percentage, '60' )
    assert.equal( calls.length, 1 )
    assert.equal( calls[ 0 ].path, '/usr/local/co.palokaj.battery/battery' )
    assert.equal( calls[ 0 ].args.join( ',' ), 'status_csv' )
    assert.equal( calls[ 0 ].options.timeout, 30000 )
} )
test( 'empty limit defaults to 60 and uses argv without a shell', async () => {
    const { api, calls } = load( '75,unknown,disabled,not discharging,' )
    await api.enable_battery_limiter()
    assert.equal( calls[ 1 ].args.join( ',' ), 'maintain,60' )
    assert.equal( calls[ 1 ].options.shell, undefined )
} )
test( 'backend errors including timeouts propagate to GUI caller', async () => {
    for( const name of [ 'initialize_battery', 'get_battery_status', 'enable_battery_limiter', 'disable_battery_limiter', 'is_limiter_enabled' ] ) {
        const { api } = load( '', new Error( 'sudo denied or command timed out' ) )
        await assert.rejects( api[ name ](), /sudo denied/ )
    }
} )
test( 'malformed or injected status cannot turn into a maintenance command', async () => {
    for( const value of [ '999,x,enabled,not discharging,60', '50,x,enabled,not discharging,60;id', '50,x,unknown,not discharging,60' ] ) {
        const { api, calls } = load( value )
        await assert.rejects( api.enable_battery_limiter(), /Invalid native/ )
        assert.equal( calls.length, 1 )
    }
} )
test( 'updater is absent and startup does not auto-enable', () => {
    assert.doesNotMatch( fs.readFileSync( 'app/main.js', 'utf8' ), /require\( ['"]update-electron-app/ )
    const ui = fs.readFileSync( 'app/modules/interface.js', 'utf8' )
    const startup = ui.slice( ui.indexOf( 'async function set_initial_interface' ), ui.indexOf( '// User interactions' ) )
    assert.doesNotMatch( startup, /await enable_battery_limiter/ )
    assert.doesNotMatch( source, /curl|osascript|pkill|update silent/ )
} )
