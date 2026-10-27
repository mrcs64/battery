const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const { EventEmitter } = require( 'node:events' )
const fs = require( 'node:fs' )
const vm = require( 'node:vm' )
const { configureOffline } = require( '../app/modules/offline' )

function fixture() {
    const app = new EventEmitter()
    const switches = new Map( [ [ 'disable-features', 'ExistingFeature' ] ] )
    let ready = false
    app.isReady = () => ready
    app.commandLine = {
        appendSwitch: ( name, value = '' ) => switches.set( name, value ),
        getSwitchValue: name => switches.get( name ) || ''
    }
    app.configureHostResolver = options => {
        assert.equal( ready, true )
        app.resolver = options
    }
    const makeSession = () => {
        const ses = { webRequest: { onBeforeRequest: fn => { ses.listener = fn } } }
        return ses
    }
    const session = { defaultSession: makeSession() }
    return { app, session, switches, makeSession, ready: () => { ready = true } }
}

test( 'early switches preserve existing features; resolver configured after ready', () => {
    const f = fixture()
    const finish = configureOffline( f.app, f.session )
    for( const flag of [ 'disable-background-networking', 'disable-component-update', 'no-proxy-server' ] ) assert.ok( f.switches.has( flag ) )
    assert.equal( f.switches.get( 'host-resolver-rules' ), 'MAP * ~NOTFOUND' )
    assert.equal( f.switches.get( 'disable-features' ), 'ExistingFeature,DnsOverHttpsUpgrade' )
    assert.equal( f.app.resolver, undefined )
    f.ready()
    finish()
    assert.deepEqual( f.app.resolver, { enableBuiltInResolver: false, secureDnsMode: 'off', secureDnsServers: [] } )
    assert.throws( () => configureOffline( f.app, f.session ), /before ready/ )
} )

test( 'default and future sessions block network including direct IPs, retaining local resources', () => {
    const f = fixture()
    const finish = configureOffline( f.app, f.session )
    const partition = f.makeSession()
    f.app.emit( 'session-created', partition )
    f.ready()
    finish()
    for( const ses of [ f.session.defaultSession, partition ] ) {
        for( const url of [ 'https://dns.google/dns-query', 'https://8.8.8.8/', 'http://127.0.0.1/', 'ws://example.com/', 'wss://example.com/', 'ftp://example.com/' ] ) {
            ses.listener( { url }, result => assert.equal( result.cancel, true ) )
        }
        for( const url of [ 'file:///assets/icon.png', 'data:text/plain,local' ] ) {
            ses.listener( { url }, result => assert.equal( result.cancel, false ) )
        }
    }
} )

test( 'main installs switches before ready and finishes policy before tray startup', async () => {
    const order = []
    const f = fixture()
    f.app.whenReady = () => { order.push( 'whenReady' ); f.ready(); return Promise.resolve() }
    f.app.dock = { hide() {} }
    vm.runInNewContext( fs.readFileSync( 'app/main.js', 'utf8' ), {
        require: name => {
            if( name === 'electron' ) return { app: f.app, session: f.session }
            if( name === './modules/offline' ) return { configureOffline: ( ...args ) => {
                order.push( 'early' )
                const finish = configureOffline( ...args )
                return () => { finish(); order.push( 'protected' ) }
            } }
            if( name === './modules/helpers' ) return { alert() {} }
            if( name === './modules/interface' ) return { set_initial_interface: () => order.push( 'tray' ) }
            throw new Error( name )
        }
    } )
    await Promise.resolve()
    assert.deepEqual( order, [ 'early', 'whenReady', 'protected', 'tray' ] )
} )

test( 'documentation links remain explicit user-clicked system browser actions', () => {
    const src = fs.readFileSync( 'app/modules/interface.js', 'utf8' )
    assert.equal( ( src.match( /click: \(\) => shell\.openExternal\( `https:\/\//g ) || [] ).length, 3 )
} )
