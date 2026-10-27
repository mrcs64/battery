const { app, session } = require( 'electron' )
const { configureOffline } = require( './modules/offline' )
const finishOfflineSetup = configureOffline( app, session )
const { alert } = require( './modules/helpers' )
const { set_initial_interface } = require( './modules/interface' )

// Fork updates are intentionally manual; never load an upstream updater.

/* ///////////////////////////////
// Event listeners
// /////////////////////////////*/

app.whenReady().then( () => {
    finishOfflineSetup()
    return set_initial_interface()
} )

/* ///////////////////////////////
// Global config
// /////////////////////////////*/

// Hide dock entry
app.dock.hide()

/* ///////////////////////////////
// Debugging
// /////////////////////////////*/
const debug = false
if( debug ) app.whenReady().then( async () => {

    await alert( __dirname )

    await alert( Object.keys( process.env ).join( '\n' ) )

    const { HOME, PATH, USER } = process.env
    await alert( `HOME: ${ HOME }\n\nPATH: ${ PATH }\n\nUSER: ${ USER }` )

} )
