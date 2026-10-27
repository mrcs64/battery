// pmset is observational only; the native backend remains the source of limit state.
const parse_power = text => {
    const source = /Now drawing from 'AC Power'/.test( text ) ? 'AC power' :
        /Now drawing from 'Battery Power'/.test( text ) ? 'Battery power' : 'Power source unavailable'
    const state = /\bnot charging\b/.test( text ) ? 'Not charging' :
        /\bdischarging\b/.test( text ) ? 'Discharging' :
            /\bcharged\b/.test( text ) ? 'Fully charged' :
                /\bcharging\b/.test( text ) ? 'Charging' : 'Charging state unavailable'
    const time = text.match( /\b(\d+:\d{2}) remaining\b/ )
    return { source, state, time: time ? time[ 1 ] : null }
}
module.exports = { parse_power }
