// The tray/backend are local-only. External help links use shell.openExternal
// on explicit menu clicks, so the user's browser is outside this policy.
const configureOffline = ( app, session ) => {
    if( app.isReady() ) throw new Error( 'Offline policy must be installed before ready' )

    // Chromium's internal requests (including DoH probes) can bypass webRequest.
    app.commandLine.appendSwitch( 'disable-background-networking' )
    app.commandLine.appendSwitch( 'disable-component-update' )
    app.commandLine.appendSwitch( 'no-proxy-server' ) // No automatic proxy/WPAD discovery.
    app.commandLine.appendSwitch( 'host-resolver-rules', 'MAP * ~NOTFOUND' )
    const disabled = app.commandLine.getSwitchValue( 'disable-features' )
    app.commandLine.appendSwitch( 'disable-features', [ disabled, 'DnsOverHttpsUpgrade' ].filter( Boolean ).join( ',' ) )

    const protectSession = ses => {
        // Electron exposes one listener per webRequest event: keep this policy
        // centralized and do not replace it when adding future session features.
        ses.webRequest.onBeforeRequest( ( details, callback ) => {
            callback( { cancel: !/^(file|data):/.test( details.url ) } )
        } )
    }
    // Covers future persistent and in-memory partitions as well as the default.
    app.on( 'session-created', protectSession )

    return () => {
        // Electron 23 requires configureHostResolver AFTER ready. The switches
        // above apply earlier, before Chromium creates its network service.
        app.configureHostResolver( {
            enableBuiltInResolver: false,
            secureDnsMode: 'off',
            secureDnsServers: []
        } )
        protectSession( session.defaultSession )
    }
}

module.exports = { configureOffline }
