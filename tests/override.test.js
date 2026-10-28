const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const { parse_override, read_override, override_status } = require( '../app/modules/override' )
test( 'versioned probe accepts only exact zero/one and rejects unknown protocols', () => {
    for( const state of [ 0, 1 ] ) assert.equal( parse_override( JSON.stringify( { version: 1, override: state } ) ), state )
    for( const text of [ '', 'garbage', 'null', '{}', '{"version":2,"override":1}', '{"version":1,"override":"1"}', '{"version":1,"override":2}' ] ) assert.equal( parse_override( text ), null )
} )
test( 'missing, denied, timeout and malformed probe all remain unknown, never active', async () => {
    for( const code of [ 'ENOENT', 'EACCES', 'ETIMEDOUT' ] ) {
        const state = await read_override( async () => { throw Object.assign( new Error( code ), { code } ) }, '/missing/probe' )
        assert.equal( state, null )
        assert.equal( override_status( '60', state ).limiter_active, false )
    }
    assert.equal( await read_override( async () => ( { stdout: 'old protocol' } ), '/probe' ), null )
} )
test( 'configured request survives override and unknown; no reason is asserted as certain', async () => {
    for( const state of [ 0, 1 ] ) {
        const observed = await read_override( async ( file, args, options ) => {
            assert.equal( file, '/probe' ); assert.deepEqual( args, [] ); assert.equal( options.shell, undefined )
            return { stdout: JSON.stringify( { version: 1, override: state } ) }
        }, '/probe' )
        const status = override_status( '60', observed )
        assert.equal( status.limiter_active, state === 0 )
        if( state === 1 ) {
            assert.match( status.override_message, /Temporarily overridden by macOS/ )
            assert.match( status.override_detail, /may.*gauge maintenance.*does not identify the reason/ )
        }
        assert.equal( override_status( '', state ).limiter_active, false )
    }
} )
