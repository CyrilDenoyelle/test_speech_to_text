const fs = require('fs')
const wav = require('wav')

const { Worker } = require('worker_threads')

const {
    Client, GatewayIntentBits, Partials,
} = require('discord.js')
const { OpusEncoder } = require('@discordjs/opus')

const {
    joinVoiceChannel, EndBehaviorType,
} = require('@discordjs/voice')

require('dotenv').config()

const apiWorker = new Worker('./apiWorker.js')

const {
    MIC_EXIT_ON_SILENCE,
    MIC_MINIMUN_RECORD_DURATION,
    DISCORD_GUILD_ID,
    DISCORD_VOICE_CHANNEL_ID,
} = process.env

const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,

    ],
    partials: [Partials.Channel],
})

discordClient.on('ready', () => {
    // Assuming you have a guild object
    const guild = discordClient.guilds.cache.get(DISCORD_GUILD_ID)

    // Join the .env voice channel
    const connection = joinVoiceChannel({
        channelId: DISCORD_VOICE_CHANNEL_ID,
        guildId: DISCORD_GUILD_ID,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
    })

    // Supprime les auditeurs pour utiliser la fonction personnalisée.
    connection.receiver.speaking.removeAllListeners()

    const talkingUsers = new Set()

    // when user start speaking
    connection.receiver.speaking.on('start', (userId) => {
        const timeStart = new Date()

        // get discord user by id
        const user = discordClient.users.cache.get(userId)

        // avoid multiple start for the same user
        if (talkingUsers.has(userId)) return
        talkingUsers.add(userId)

        const subscription = connection.receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: MIC_EXIT_ON_SILENCE,
            },
        })

        const audioFileName = `./recorded_audios/${new Date().toISOString().replace(/:/g, '-')}-${user.username}.wav`

        const outputFileStream = new wav.FileWriter(audioFileName, {
            sampleRate: 48000,
            bitDepth: 16,
            channels: 1,
        })

        const encoder = new OpusEncoder(48000, 1)

        // write chunks of data to the file
        subscription.on('data', (chunk) => {
            outputFileStream.write(encoder.decode(chunk))
        })

        subscription.once('end', async () => {
            // check if record duration is not too short
            if (new Date() - MIC_EXIT_ON_SILENCE - timeStart < MIC_MINIMUN_RECORD_DURATION) {
                talkingUsers.delete(userId)

                // delete the too short output file
                outputFileStream.end(() => {
                    fs.unlinkSync(audioFileName)
                })
                return
            }

            // give audio to worker
            outputFileStream.end(() => {
                apiWorker.postMessage({ f: 'sendAudioToOpenAi', args: [audioFileName] })
            })

            // remove user from talkingUsers
            talkingUsers.delete(userId)
        })
    })
})

discordClient.login(process.env.DISCORD_SECRET)
