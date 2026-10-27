const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const vm = require( 'node:vm' )
const fs = require( 'node:fs' )
const source = fs.readFileSync( 'app/modules/interface.js', 'utf8' )
function load( failure = false, response = 0 ) {
    const calls = []
    const status = { battery_state: '71% — Not charging', daemon_state: 'System charge limit: 60%', power: { source: 'AC power' }, percentage: '71', maintain_percentage: '60', limiter_enabled: true }
    const module = { exports: {} }
    const backend = {
        LIMIT_PRESETS: [ '60', '70', '80', '90', '100' ],
        get_battery_status: async () => { if( failure ) throw new Error( 'backend failed' ); return status },
        set_battery_limit: async value => calls.push( value ),
        disable_battery_limiter: async () => { calls.push( 'restore' ); return '71' }
    }
    const electron = {
        app: { getVersion: () => '1.0.11-mrcs64.1' },
        Menu: { buildFromTemplate: value => value },
        dialog: { showMessageBox: async () => ( { response } ) }
    }
    vm.runInNewContext( source + '\ntray = { setImage() {} }; module.exports = { generate_app_menu, disable_limiter };', {
        module, require: name => name === 'electron' ? electron : name === './battery' ? backend : name === './helpers' ? { log() {}, alert() {} } : { get_active_logo() {}, get_inactive_logo() {} }
    } )
    return { api: module.exports, calls }
}
test( 'menu groups telemetry and presets, keeps caveat in About, and renders fork version', async () => {
    const { api, calls } = load()
    const menu = await api.generate_app_menu()
    assert.equal( menu[ 0 ].label, 'Battery: 71% — Not charging' )
    assert.equal( menu[ 1 ].label, 'Power source: AC power' )
    assert.equal( menu[ 2 ].label, 'System charge limit: 60%' )
    const presets = menu.find( item => item.label === 'Set charge limit' ).submenu
    assert.equal( presets.map( item => item.label ).join( ',' ), '60%,70%,80%,90%,100%' )
    assert.equal( presets.filter( item => item.checked ).length, 1 )
    assert.match( menu.find( item => item.submenu && item.label && item.label.startsWith( 'Battery v' ) ).label, /1.0.11-mrcs64.1.*mrcs64 fork/ )
    assert.match( menu.find( item => item.label && item.label.startsWith( 'Battery v' ) ).submenu[ 0 ].label, /physical enforcement not verified/ )
    assert.equal( calls.length, 0 )
} )
test( 'unavailable backend presents error and no charge-changing actions', async () => {
    const { api, calls } = load( true )
    const menu = await api.generate_app_menu()
    assert.equal( menu[ 0 ].label, 'Native backend unavailable' )
    assert.equal( menu.length, 3 )
    assert.equal( calls.length, 0 )
} )
test( 'restore confirmation defaults to cancellation with no backend mutation', async () => {
    const { api, calls } = load()
    await api.disable_limiter()
    assert.equal( calls.length, 0 )
} )
