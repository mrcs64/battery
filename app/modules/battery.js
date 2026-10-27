const { execFile } = require( 'node:child_process' )
const { promisify } = require( 'node:util' )
const run = promisify( execFile )
const battery = '/usr/local/co.palokaj.battery/battery'
const { parse_power } = require( './power' )
const LIMIT_PRESETS = [ '60', '70', '80', '90', '100' ]

const call = async ( ...args ) => {
    const { stdout } = await run( battery, args, { timeout: 30000, maxBuffer: 1024 * 1024 } )
    return stdout.trim()
}

const get_battery_status = async () => {
    const message = await call( 'status_csv' )
    const [ percentage, remaining, charging, discharging, limit ] = message.split( ',' )
    if( !/^\d{1,3}$/.test( percentage ) || Number( percentage ) > 100 ||
        ![ 'enabled', 'disabled' ].includes( charging ) || discharging !== 'not discharging' ||
        !( limit === '' || /^(?:[1-9]|[1-9][0-9]|100)$/.test( limit ) ) ) {
        throw new Error( 'Invalid native backend status' )
    }
    let power = parse_power( '' )
    try {
        const { stdout } = await run( '/usr/bin/pmset', [ '-g', 'batt' ], { timeout: 5000, maxBuffer: 65536 } )
        power = parse_power( stdout )
    } catch { /* Keep native limit controls available if power telemetry fails. */ }
    return {
        power, percentage, remaining, charging: power.state === 'Charging', discharging: power.state === 'Discharging',
        maintain_percentage: limit || '60', limiter_enabled: limit !== '',
        battery_state: `${ percentage }% — ${ power.state }${ power.time ? ` (${ power.time } ${ power.state === 'Charging' ? 'until full' : 'remaining' })` : '' }`,
        daemon_state: limit ? `System charge limit: ${ limit }%` : 'System charge limit: not set by Battery'
    }
}
const enable_battery_limiter = async () => {
    const status = await get_battery_status()
    await call( 'maintain', status.maintain_percentage )
    return status.percentage
}
const set_battery_limit = async value => {
    if( !LIMIT_PRESETS.includes( value ) ) throw new Error( 'Invalid charge limit preset' )
    await call( 'maintain', value )
}
const disable_battery_limiter = async () => {
    await call( 'maintain', 'stop' )
    return ( await get_battery_status() ).percentage
}
// Read-only startup: no installer, network calls, process kills or automatic enable.
const initialize_battery = async () => get_battery_status()
const is_limiter_enabled = async () => ( await get_battery_status() ).limiter_enabled
module.exports = { LIMIT_PRESETS, set_battery_limit, get_battery_status, enable_battery_limiter, disable_battery_limiter, initialize_battery, is_limiter_enabled }
