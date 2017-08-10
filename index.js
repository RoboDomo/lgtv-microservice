process.env.DEBUG='LGTVHost'

const debug    = require('debug')('LGTVHost'),
      HostBase = require('microservice-core/HostBase'),
      wol      = require('wake_on_lan')

const TOPIC_ROOT  = process.env.TOPIC_ROOT || 'lgtv',
      MQTT_HOST   = process.env.MQTT_HOST,
      LGTV_HOSTS = process.env.LGTV_HOSTS.split(',')

const SUBSCRIPTIONS = {
    foregroundApp:    "ssap://com.webos.applicationManager/getForegroundAppInfo",
    appStatus:        "ssap://com.webos.service.appstatus/getAppStatus",
    appState:         "ssap://system.launcher/getAppState",
    volume:           "ssap://audio/getVolume",
    mute:             "ssap://audio/getMute",
    volumeStatus:     "ssap://audio/getStatus",
    // CHANNEL_LIST:   "ssap://tv/getChannelList",
    // CHANNEL:        "ssap://tv/getCurrentChannel",
    // PROGRAM:        "ssap://tv/getChannelProgramInfo",
    CLOSE_APP_URI:    "ssap://system.launcher/close",
    CLOSE_MEDIA_URI:  "ssap://media.viewer/close",
    CLOSE_WEBAPP_URI: "ssap://webapp/closeWebApp",
    powerOn:          'ssap://power/on',
    powerOff:         'ssap://power/off'
}

class LGTVHost extends HostBase {
    constructor(host) {
        super(MQTT_HOST, TOPIC_ROOT + '/' + host)
        try {
            this.host = host
            this.isConnected = false

            debug(this.host, 'constructor')
            this.connected = this.connected.bind(this)
            this.connect()
        }
        catch (e) {
            debug(this.host, 'Exception', e.message)
        }
    }

    connect() {
        const url = `ws://${this.host}:3000`

        debug(this.host, 'connect', this.host, url)

        const lgtv = this.lgtv = require('lgtv2')({
            url:     url,
            keyFile: `./lgtv-${this.host}-keyFile`
        })

        // TODO: verify this is the right sequence
        lgtv.on('error', (e) => {
            debug('error', e)
            this.mouseSocket = null
        })

        lgtv.on('disconnect', (err) => {
            debug('disconnect')
            if (err) {
                this.state = { power: 'off'}
                console.log('lgtv connect error', e)
                return
            }
            debug(this.host, 'disconnected')
            this.isConnected = false
            this.mouseSocket = null
            this.lgtv        = null
            this.state = { power: 'off'}
            this.emit('disconnect')
            // maybe call this.connect()?
        })

        lgtv.on('connect', this.connected)
    }

    async getMouseSoocket() {
        if (!this.isConnected) {
            return Promise.reject(new Error('LGTV not connected'))
        }

        const lgtv = this.lgtv
        return new Promise((resolve, reject) => {
            lgtv.getSocket('ssap://com.webos.service.networkinput/getPointerInputSocket', (err, sock) => {
                debug('got mouse socket')
                if (err) {
                    debug(this.host, 'Exception', err)
                    reject(err)
                    return
                }
                resolve(sock)
            })
        })
    }

    processLaunchPoints(raw) {
        const launchPoints = {}
        // debug(this.host, raw.launchPoints[0])
        raw.launchPoints.forEach((app) => {
            const key = app.id
            // debug(this.host, 'app', key)
            if (key.indexOf('vudu') !== -1) {
                app.icon      = '/img/vudu.png'
                app.iconLarge = '/img/vudu_128x128.png'
            }
            launchPoints[key] = app
        })
        return launchPoints
    }

    async connected() {
        debug(this.host, 'connected')
        const lgtv = this.lgtv

        this.isConnected = true

        try {
            // get mouse socket, which is used to send keystrokes
            this.mouseSocket        = await this.getMouseSoocket()
            // get launch points (apps)
            this.state = {
                launchPoints: this.processLaunchPoints(await this.request('com.webos.applicationManager/listLaunchPoints'))
            }
            Object.keys(SUBSCRIPTIONS).forEach((key) => {
                this.subscribe(SUBSCRIPTIONS[key], key)
            })
            lgtv.subscribe('ssap://com.webos.applicationManager/listLaunchPoints', (err, info) => {
                if (err) {
                    debug(this.host, 'exception', err)
                    return
                }
                this.state = {
                    launchPoints:  this.processLaunchPoints(info)
                }
            })
            this.state = { power: 'on'}
        }
        catch (e) {
            debug('exception', e)
        }

        this.emit('connect')
    }

    subscribe(topic, member) {
        this.lgtv.subscribe(topic, (err, info) => {
            debug(this.host, 'subscribed', member)
            if (err) {
                debug(this.host, 'ERROR', err)
            }
            else {
                debug(this.host, member, info)
                const state         = {}
                state[member] = info
                if (state.foregroundApp && state.foregroundApp.appId === '') {
                    state.power = 'off'
                }
                else if (this.state.power === 'off' && this.isConnected) {
                    debug('power on')
                    state.power = 'on'
                }
                this.state = state
            }
        })
    }

    power(state) {
        const mac = this.mac
        if (!mac) {
            return Promise.reject(new Error('No Mac address'))
        }

        return new Promise((resolve, reject) => {
            if (state === 'on' || state === true) {
                wol.wake(mac, (error) => {
                    if (error) {
                        reject(error)
                    }
                    else {
                        let countdown = 5,
                            wait      = () => {
                                setTimeout(() => {
                                    if (this.state.power === 'on') {
                                        resolve()
                                        return
                                    }
                                    if (--countdown < 0) {
                                        reject(new Error('LGTV did not power on'))
                                    }
                                    else {
                                        wait()
                                    }
                                }, 1000)
                            }
                    }
                })
            }
            else {
                if (!this.isConnected) {
                    return Promise.reject(new Error('LGTV not connected'))
                }
                this.lgtv.request('ssap://system/turnOff', () => {
                    resolve()
                })
            }
        })
    }

    sendKey(key) {
        return new Promise((resolve, reject) => {
            if (this.mouseSocket && this.isConnected) {
                debug('send', key)
                this.mouseSocket.send('button', {name: key})
                resolve()
            }
            else {
                reject(new Error('LGTV not connected'))
            }
        })
    }

    request(command, args = {}) {
        if (!this.isConnected) {
            return Promise.reject(new Error('LGTV not connected'))
        }

        return new Promise((resolve, reject) => {
            this.lgtv.request(`ssap://${command}`, args, (err, res) => {
                if (err) {
                    reject(err)
                }
                else {
                    resolve(res)
                }
            })
        })
    }

    command(key, command) {
        debug(this.host, 'command', key, command)
        if (command === 'POWERON') {
            return this.power(true)
        }
        else if (command === 'POWEROFF') {
            return this.power(false)
        }
        else if (command.startsWith('KEY_')) {
            return this.sendKey(command.substr(4))
        }
        else if (command.startsWith('LAUNCH-')) {
            return this.request('system.launcher/launch', {id: command.substr(7)})
        }
        else {
            switch (command) {
                case 'REWIND':
                    return this.request('media.controls/rewind')
                case 'STOP':
                    return this.request('media.controls/stop')
                case 'PAUSE':
                    return this.request('media.controls/pause')
                case 'PLAY':
                    return this.request('media.controls/play')
                case 'FASTFORWARD':
                    return this.request('media.controls/fastForward')
                case 'BACK':
                    return this.request('media.controls/back')
                default:
                    Promise.reject(new Error('Unknown command ' + command))
            }
        }
    }
}


const tvs = {}

function main() {
    if (!MQTT_HOST) {
        console.log('ENV variable MQTT_HOST not found')
        process.exit(1)
    }
    if (!LGTV_HOSTS || !LGTV_HOSTS.length) {
        console.log('ENV variable LGTV_HOSTS not found')
        process.exit(1)
    }
    LGTV_HOSTS.forEach((host) => {
        tvs[host] = new LGTVHost(host)
    })
}

main()
