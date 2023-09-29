const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
const mic = require('mic')
const gptTokenizer = require('gpt-tokenizer')

gptTokenizer.default.modelName = 'cl100k_base'

const { Readable } = require('stream')

const { Worker } = require('worker_threads')

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path

require('dotenv').config()

ffmpeg.setFfmpegPath(ffmpegPath)

const rolesNames = {
    user: process.env.PROMPT_USER_NAME,
    assistant: process.env.PROMPT_ASSISTANT_NAME,
}

let i = 0

// Record audio
async function recordAudio() {
    return new Promise((resolve, reject) => {
        let recordTime = 0
        const filename = `recorded_audios/recorded_audio${i}.wav`

        setInterval(() => {
            recordTime += 1
        }, 1000)

        const micInstance = mic({
            rate: '16000',
            channels: '1',
            fileType: 'wav',
            exitOnSilence: process.env.MIC_EXIT_ON_SILENCE,
        })

        console.log(`-rec-${i}-start`)
        const micInputStream = micInstance.getAudioStream()
        const output = fs.createWriteStream(filename)
        const writable = new Readable().wrap(micInputStream)

        writable.pipe(output)

        micInstance.start()

        micInputStream.on('silence', async () => {
            micInstance.stop()

            if (recordTime <= process.env.MIC_MINIMUN_RECORD_DURATION) {
                // too short, retry
                const retryFileName = await recordAudio()
                resolve(retryFileName)
            } else {
                console.log(`-rec-${i}-stop-${recordTime}`)
                i += 1
                resolve(filename)
            }
        })

        micInputStream.on('error', reject)
    })
}

const twitchChatUsers = []

const twitchChatUserString = async () => {
    if (twitchChatUsers.length === 0) return ''
    if (twitchChatUsers.length === 1) return `L'utilisateur: ${twitchChatUsers[0]} est dans le chat twitch.`
    return `Les utilisateurs: ${twitchChatUsers.slice(0, -1).join(', ')} et ${twitchChatUsers.slice(-1)} sont dans le chat twitch.`
}

const systemMessages = () => [
    {
        role: 'system',
        content: `tu es l'assistant, tu te nommes ${rolesNames.assistant} et tu ne réponds qu'en ton nom.
Le pseudo de l'utilisateur principal est ${rolesNames.user}.
L'assistant fait des réponses courtes et précises.
Il y a toujours le nom de l'utilisateur qui s'exprime devant les messages.
${twitchChatUserString()}`,
    },
    {
        role: 'user',
        content: `Dit moi ${rolesNames.assistant} comment ça va ?`,
    },
    {
        role: 'assistant',
        content: `${rolesNames.assistant}: Salut ${rolesNames.user}, ça va très bien, et vous ?`,
    },
    {
        role: 'user',
        content: `(twitch chat) Xx_dark_sasuke_xX: "Bonjour ${rolesNames.assistant} !"`,
    },
    {
        role: 'assistant',
        content: `${rolesNames.assistant}: Salut Xx_dark_sasuke_xX, ça va super, et toi ?`,
    },
]

const messages = []
const messagesPush = (message) => {
    messages.push(message)

    // shift messages until total tokens is less than process.env.OPENAI_API_MAX_CHAT_TOTAL_TOKEN
    while (gptTokenizer.isWithinTokenLimit(
        [...systemMessages(), ...messages]
            .map((m) => `${m.role}: "${m.content}"\n`)
            .join(''),
        parseInt(process.env.OPENAI_API_MAX_CHAT_TOTAL_TOKEN, 10),
    ) === false) {
        messages.shift()
    }
}

const apiWorker = new Worker('./apiWorker.js')

const functions = {
    addMarker: () => console.log('adding marker'),
}

apiWorker.on('message', (message) => {
    const { from, message: { role, content, functionCall } } = message

    let line = ''

    if (functionCall) {
        if (functions[functionCall.name]) {
            functions[functionCall.name](...functionCall.args)
            // write message to file with time of message to europ format
            fs.appendFileSync('messages.txt', `${new Date().toLocaleString('fr-FR')}\nfunctionCall: ${functionCall.name}\n\n`)
        }
        return
    }

    if (from.includes('twitchChat')) {
        const twitchChatUsername = from.split(':')[1]
        if (!twitchChatUsers.includes(twitchChatUsername)) twitchChatUsers.push(twitchChatUsername)

        line = `(twitch chat) ${twitchChatUsername}: "${content.replace('"', '\'\'')}"`
    } else {
        line = `${rolesNames[from] || from}: ${content}`
    }

    // write message to file with time of message to europ format
    fs.appendFileSync('messages.txt', `${new Date().toLocaleString('fr-FR')}\n${line}\n\n`)

    messagesPush({
        role,
        content: line,
    })

    // if assistant name is in text, ask worker for an openai answer
    if (role === 'user' && content.includes(`${rolesNames.assistant}`)) {
        apiWorker.postMessage({
            f: 'sendChatToOpenAi',
            args: [[
                ...systemMessages(),
                ...messages.map((m) => ({
                    role: m.role,
                    content: m.content,
                })),
            ]],
        })
    } else if (role === 'assistant') {
        console.log('sending to twitch chat')
        apiWorker.postMessage({ f: 'sendMessageToChat', args: [content] })
    }
})

// main function
async function main() {
    // record audio and resolve when it's usable
    const audioFilename = await recordAudio()

    apiWorker.postMessage({ f: 'sendAudioToOpenAi', args: [audioFilename] })

    main()
}

console.log('Recording... Press Ctrl+C to stop.')
main()
