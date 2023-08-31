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

const systemMessages = [
    {
        role: 'system',
        content: `tu es l'assistant et tu te nommes ${rolesNames.assistant}.
L'assistant fait des réponses courtes et précises.
Le pseudo de l'utilisateur principal est ${rolesNames.user}.
Il y a toujours le nom de la personne qui parle devant un message.`,
    },
]

const messages = []
const messagesPush = (message) => {
    messages.push(message)
    // sum up the total tokens used by openai

    const getTotalTokens = (ms) => ms.reduce((acc, m) => {
        if (m.totalTokens) {
            return acc + m.totalTokens
        }
        return acc
    }, 0)
    let totalTokens = getTotalTokens(messages)

    // shift messages until total tokens is less than process.env.OPENAI_API_MAX_CHAT_TOTAL_TOKEN
    while (totalTokens > parseInt(process.env.OPENAI_API_MAX_CHAT_TOTAL_TOKEN, 10)) {
        messages.shift()
        totalTokens = getTotalTokens(messages)
    }
}

const apiWorker = new Worker('./apiWorker.js')

apiWorker.on('message', (message) => {
    const { from, message: { role, content, totalTokens } } = message

    const line = role === 'assistant'
        ? content
        : `${rolesNames[from] || from}: ${content}`

    console.log(line)

    messagesPush({
        role,
        content: line,
        totalTokens,
    })

    // if assistant name is in text, ask worker for an openai answer
    if (role === 'user' && content.includes(`${rolesNames.assistant}`)) {
        apiWorker.postMessage({
            f: 'sendChatToOpenAi',
            args: [[
                ...systemMessages,
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
