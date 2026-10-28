const { app, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const vm = require('vm')
app.whenReady().then(async () => {
    try {
        process.resourcesPath = path.resolve('app/dist/mac-arm64/battery.app/Contents/Resources')
        const root = path.join(process.resourcesPath, 'app.asar')
        const status = await require(path.join(root, 'modules/battery')).get_battery_status()
        const mod = { exports: {} }
        const source = fs.readFileSync(path.join(root, 'modules/interface.js'), 'utf8')
        vm.runInNewContext(source + '\ntray = {setImage() {}}; module.exports = {generate_app_menu};', {
            module: mod,
            require: name => name === 'electron' ? require('electron') : name === './battery' ? require(path.join(root, 'modules/battery')) : name === './helpers' ? {log() {}, alert() {}} : {get_active_logo() {}, get_inactive_logo() {}}
        })
        const menu = await mod.exports.generate_app_menu()
        console.log(JSON.stringify({resources: process.resourcesPath, status, menu: menu.items.map(i => ({label:i.label, enabled:i.enabled, checked:i.checked}))}, null, 2))
        if(status.override_state === 1 && (status.limiter_active !== false || !menu.items.some(i => /Temporarily overridden/.test(i.label)))) throw new Error('Live acceptance failed')
        app.exit(0)
    } catch(e) { console.error(e); app.exit(1) }
})