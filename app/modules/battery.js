const { execFile } = require( 'node:child_process' )
const { promisify } = require( 'node:util' )
const run = promisify( execFile )
const battery = '/usr/local/co.palokaj.battery/battery'

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
    return {
        percentage, remaining, charging: charging === 'enabled', discharging: false,
        maintain_percentage: limit || '60', limiter_enabled: limit !== '',
        battery_state: `${ percentage }% (${ remaining } remaining)`,
        daemon_state: limit ? `Native ${ limit }% request; enforcement unverified` : 'Native limit disabled'
    }
}
const enable_battery_limiter = async () => {
    const status = await get_battery_status()
    await call( 'maintain', status.maintain_percentage )
    return status.percentage
}
const disable_battery_limiter = async () => {
    await call( 'maintain', 'stop' )
    return ( await get_battery_status() ).percentage
}
// Read-only startup: no installer, network calls, process kills or automatic enable.
const initialize_battery = async () => get_battery_status()
const is_limiter_enabled = async () => ( await get_battery_status() ).limiter_enabled
module.exports = { get_battery_status, enable_battery_limiter, disable_battery_limiter, initialize_battery, is_limiter_enabled }
