const { shell, app, Tray, Menu, powerMonitor, nativeTheme, dialog } = require( 'electron' )
const { disable_battery_limiter, initialize_battery, is_limiter_enabled, get_battery_status, LIMIT_PRESETS, set_battery_limit } = require( './battery' )
const { log, alert } = require( './helpers' )
const { get_inactive_logo, get_active_logo } = require( './theme' )

/* ///////////////////////////////
// Menu helpers
// /////////////////////////////*/
let tray = undefined

// Set interface to usable
const generate_app_menu = async () => {

    try {
        // Get battery and daemon status
        const { battery_state, daemon_state, power, maintain_percentage, percentage, limiter_enabled: limiter_on } = await get_battery_status()

        // Set tray icon
        log( `Generate app menu percentage: ${ percentage }` )
        tray.setImage( limiter_on ? get_active_logo( percentage ) : get_inactive_logo( percentage ) )

        // Build menu
        return Menu.buildFromTemplate( [

            { label: `Battery: ${ battery_state }`, enabled: false },
            { label: `Power source: ${ power.source }`, enabled: false },
            { label: daemon_state, enabled: false },
            { type: 'separator' },
            {
                label: 'Set charge limit',
                submenu: LIMIT_PRESETS.map( value => ( {
                    label: `${ value }%`, type: 'checkbox',
                    checked: limiter_on && maintain_percentage === value,
                    click: () => change_limit( value )
                } ) )
            },
            {
                label: 'Restore previous settings…',
                enabled: limiter_on,
                click: disable_limiter
            },
            // eslint-disable-next-line no-use-before-define
            { label: 'Refresh status', click: () => refresh_tray() },
            { type: 'separator' },
            {
                label: `Battery v${ app.getVersion() } — mrcs64 fork`,
                submenu: [
                    {
                        label: 'Limit is a system request; physical enforcement not verified',
                        enabled: false
                    },
                    {
                        label: `User manual`,
                        click: () => shell.openExternal( `https://github.com/mrcs64/battery/blob/feature/macos27-root-mcl60/docs/NATIVE.md` )
                    },
                    {
                        type: 'normal',
                        label: 'Command-line usage',
                        click: () => shell.openExternal( `https://github.com/mrcs64/battery/blob/feature/macos27-root-mcl60/docs/NATIVE.md#contract` )
                    },
                    {
                        type: 'normal',
                        label: 'Help and feature requests',
                        click: () => shell.openExternal( `https://github.com/actuallymentor/battery/issues` )
                    }
                ]
            },
            {
                label: 'Quit',
                click: () => {
                    tray.destroy()
                    app.quit()
                }
            }
            
        ] )
    } catch ( e ) {
        log( `Error generating menu: `, e )
        tray.setImage( get_inactive_logo() )
        return Menu.buildFromTemplate( [
            { label: 'Native backend unavailable', enabled: false },
            { label: 'Show error', click: () => alert( e.message ) },
            { label: 'Quit', click: () => app.quit() }
        ] )
    }

}

// Periodic refreshing of icon and state
let refresh_timer = undefined
const set_interface_update_timer = async ( disable_only=false ) => {

    if( !disable_only ) log( `Refreshing interface update timer` )
    else log( `Disabling interface update timer due to disable_only set to `, disable_only )

    // Calculate update speed
    let status
    try {
        status = await get_battery_status()
    } catch ( e ) {
        log( 'Cannot refresh native status: ', e )
        return
    }
    const { maintain_percentage=60, percentage, charging } = status
    const percentage_delta = Math.floor( Math.abs( percentage - maintain_percentage ) )
    const slow_refresh_interval_in_ms = 1000 * 60 * 10
    const fast_refresh_interval_in_ms = 1000 * 60 * .5
    const battery_full_and_charging = charging && percentage == 100
    const refresh_speed =  percentage_delta < 5 || powerMonitor.onBatteryPower || battery_full_and_charging  ? slow_refresh_interval_in_ms : fast_refresh_interval_in_ms
    log( `Setting interface refresh speed to ${ refresh_speed / 1000 / 60 } minutes` )
    if( refresh_timer ) clearInterval( refresh_timer )
    // eslint-disable-next-line no-use-before-define
    if( !disable_only ) refresh_timer = setInterval( refresh_tray, refresh_speed )

}

// Refresh tray with battery status values
const refresh_tray = async ( force_interactive_refresh = false ) => {

    log( "Refreshing tray icon..." )
    const new_menu = await generate_app_menu()
    if( force_interactive_refresh ) {
        log( `Forcing interactive refresh ${ force_interactive_refresh }` )
        tray.closeContextMenu()
        tray.popUpContextMenu( new_menu )
    }
    tray.setContextMenu( new_menu )

    // Refresh timer 
    log( `Resetting interface timer speed` )
    set_interface_update_timer()

}

// Refresh app logo
const refresh_logo = async ( percent=80, force ) => {

    log( `Refresh logo for percentage ${ percent }, force ${ force }` )
    if( force == 'active' ) return tray.setImage( get_active_logo( percent ) )
    if( force == 'inactive' ) return tray.setImage( get_inactive_logo( percent ) )

    const is_enabled = await is_limiter_enabled()
    if( is_enabled ) return tray.setImage( get_active_logo( percent ) )
    return tray.setImage( get_inactive_logo( percent ) )
}


/* ///////////////////////////////
// Initialisation
// /////////////////////////////*/
async function set_initial_interface() {

    log( "Starting tray app" )
    tray = new Tray( get_inactive_logo() )

    // Set "loading" context
    tray.setTitle( '  loading...' )
    
    log( "Tray app boot complete" )

    try {
        await initialize_battery()
    } catch ( e ) {
        await alert( `Native backend unavailable: ${ e.message }. Install the reviewed local fork; no password will be requested by the app.` )
        app.quit()
        return
    }
    log( "App initialisation process complete" )


    // Set tray styles
    tray.setTitle( '' )
    await refresh_tray()

    // Set tray open listener
    tray.on( 'mouse-enter', () => refresh_tray() )
    tray.on( 'click', () => refresh_tray() )
    nativeTheme.on( 'updated', () => refresh_tray() )

    // refresh_tray already starts the timer; avoid concurrent native status reads.
    powerMonitor.on( 'lock-screen', () => set_interface_update_timer( true ) )
    powerMonitor.on( 'unlock-screen', () => set_interface_update_timer() )
    powerMonitor.on( 'suspend', () => set_interface_update_timer( true ) )
    powerMonitor.on( 'resume', () => set_interface_update_timer() )

}

/* ///////////////////////////////
// User interactions
// /////////////////////////////*/
async function change_limit( value ) {
    try {
        await set_battery_limit( value )
    } catch ( e ) {
        await alert( e.message )
    }
    await refresh_tray()
}

async function disable_limiter() {
    const { response } = await dialog.showMessageBox( {
        type: 'question', buttons: [ 'Cancel', 'Restore previous settings' ],
        defaultId: 0, cancelId: 0,
        message: 'Restore the settings saved before Battery first changed the limit?',
        detail: 'This restores the original saved values (including settings that were absent), not a new 100% limit. Quitting Battery alone does not restore settings.'
    } )
    if( response !== 1 ) return

    try {
        log( 'Disable limiter' )
        const percent_left = await disable_battery_limiter()
        log( `Interface enabled limiter, percentage remaining: ${ percent_left }` )
        await refresh_logo( percent_left, 'inactive' )
        await refresh_tray()
    } catch ( e ) {
        log( `Error in disable_limiter: `, e )
        await alert( e.message )
        await refresh_tray()
    }

}

module.exports = {
    set_initial_interface
}