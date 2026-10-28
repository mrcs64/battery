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
    vm.runInNewContext( source, { module, require: name => name === 'node:child_process' ? { execFile } : name === './power' ? require( '../app/modules/power' ) : name === './override' ? { ...require( '../app/modules/override' ), read_override: async () => null } : require( name ) } )
    return { api: module.exports, calls }
}
test( 'startup reads status once without enabling/updating/killing/installing', async () => {
    const { api, calls } = load()
    const status = await api.initialize_battery()
    assert.equal( status.maintain_percentage, '60' )
    assert.equal( calls.length, 2 )
    assert.equal( calls[ 1 ].path, '/usr/bin/pmset' )
    assert.equal( calls[ 0 ].path, '/usr/local/co.palokaj.battery/battery' )
    assert.equal( calls[ 0 ].args.join( ',' ), 'status_csv' )
    assert.equal( calls[ 0 ].options.timeout, 30000 )
} )
test( 'empty limit defaults to 60 and uses argv without a shell', async () => {
    const { api, calls } = load( '75,unknown,disabled,not discharging,' )
    await api.enable_battery_limiter()
    assert.equal( calls[ 2 ].args.join( ',' ), 'maintain,60' )
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

test( 'presets are literal validated argv and restore uses maintain stop', async () => {
    for( const value of [ '60', '70', '80', '90', '100' ] ) {
        const { api, calls } = load()
        await api.set_battery_limit( value )
        assert.equal( calls.length, 1 )
        assert.equal( JSON.stringify( calls[ 0 ].args ), JSON.stringify( [ 'maintain', value ] ) )
        assert.equal( calls[ 0 ].options.shell, undefined )
    }
    for( const value of [ 60, '60;id', '0', '101', '--help', undefined ] ) {
        const { api, calls } = load()
        await assert.rejects( api.set_battery_limit( value ), /Invalid charge/ )
        assert.equal( calls.length, 0 )
    }
    const { api, calls } = load()
    await api.disable_battery_limiter()
    assert.equal( calls[ 0 ].args.join( ',' ), 'maintain,stop' )
    await assert.rejects( load( '', new Error( 'backend failed' ) ).api.set_battery_limit( '60' ), /backend failed/ )
} )

test( 'pmset AC, battery, charged, unknown and missing time states', () => {
    const { parse_power } = require( '../app/modules/power' )
    const cases = [
        [ 'AC Power', 'not charging present: true', 'Not charging', null ],
        [ 'AC Power', 'charging; 1:20 remaining', 'Charging', '1:20' ],
        [ 'AC Power', 'charged; 0:00 remaining', 'Fully charged', '0:00' ],
        [ 'Battery Power', 'discharging; 2:45 remaining', 'Discharging', '2:45' ],
        [ 'Battery Power', 'discharging; (no estimate)', 'Discharging', null ],
        [ 'AC Power', 'charging; (no estimate)', 'Charging', null ]
    ]
    for( const [ source, tail, state, time ] of cases ) {
        const power = parse_power( `Now drawing from '${ source }'\n -InternalBattery-0 71%; ${ tail }` )
        assert.equal( power.source, source === 'AC Power' ? 'AC power' : 'Battery power' )
        assert.equal( power.state, state )
        assert.equal( power.time, time )
    }
    assert.equal( parse_power( '' ).source, 'Power source unavailable' )
    assert.equal( parse_power( 'unrecognized' ).state, 'Charging state unavailable' )
} )

test( 'pmset failure keeps backend state and controls available without invented telemetry', async () => {
    const module = { exports: {} }
    const execFile = () => {}
    execFile[ require( 'node:util' ).promisify.custom ] = async path => {
        if( path === '/usr/bin/pmset' ) throw new Error( 'pmset timed out' )
        return { stdout: '71,unknown,disabled,not discharging,60' }
    }
    vm.runInNewContext( source, { module, require: name => name === 'node:child_process' ? { execFile } : name === './power' ? require( '../app/modules/power' ) : name === './override' ? { ...require( '../app/modules/override' ), read_override: async () => null } : require( name ) } )
    const status = await module.exports.get_battery_status()
    assert.equal( status.daemon_state, 'Configured system charge limit: 60%' )
    assert.equal( status.limiter_enabled, true )
    assert.match( status.battery_state, /Charging state unavailable/ )
    assert.doesNotMatch( status.battery_state, /unknown remaining/ )
    assert.equal( status.power.source, 'Power source unavailable' )
} )
