const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
const mic = require('mic')
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
            exitOnSilence: 5,
        })

        console.log(`-rec-${i}-start`)
        const micInputStream = micInstance.getAudioStream()
        const output = fs.createWriteStream(filename)
        const writable = new Readable().wrap(micInputStream)

        writable.pipe(output)

        micInstance.start()

        micInputStream.on('silence', async () => {
            micInstance.stop()

            if (recordTime <= 5) {
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

const messages = [
    {
        role: 'system',
        content: `tu es l'assistant et tu te nommes ${rolesNames.assistant}.
L'assistant fait des réponses courtes et précises.
D'autres utilisateurs parlent.
Le pseudo de l'utilisateur qui parle est ajouté au début de chaque message.
Le pseudo de l'utilisateur principal est ${rolesNames.user}.
l'assistant ne met pas son pseudo au début de ses messages.`,
    },
]

const openAiQueue = new Worker('./workers/openAiQueue.js')
const twitchApiQueue = new Worker('./workers/twitchApiQueue.js')

openAiQueue.on('message', (message) => {
    const { role, content } = message

    console.log(`${rolesNames[role]}: ${content}`)
    messages.push({
        role,
        content: `${rolesNames[role]}: ${content}`,
    })

    // if assistant name is in text, ask worker for an openai answer
    if (role === 'user' && content.includes(`${rolesNames.assistant}`)) {
        openAiQueue.postMessage({ f: 'sendChatToOpenAi', args: [messages] })
    } else if (role === 'assistant') {
        twitchApiQueue.postMessage({ f: 'sendMessageToChat', args: [content] })
    }
})

twitchApiQueue.on('message', (message) => {
    const { role, content } = message

    console.log(`in twitch chat: ${content}`)
    messages.push({ role, content })

    // if assistant name is in text, ask worker for an openai answer
    if (role === 'user' && content.includes(`${rolesNames.assistant}`)) {
        openAiQueue.postMessage({ f: 'sendChatToOpenAi', args: [messages] })
    }
})

// main function
async function main() {
    // record audio and resolve when it's usable
    const audioFilename = await recordAudio()

    openAiQueue.postMessage({ f: 'sendAudioToOpenAi', args: [audioFilename] })

    main()
}

console.log('Recording... Press Ctrl+C to stop.')
main()
