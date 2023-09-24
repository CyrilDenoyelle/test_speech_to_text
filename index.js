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

const systemMessages = [
    {
        role: 'system',
        content: `tu es l'assistant, tu te nommes ${rolesNames.assistant} et tu ne réponds qu'en ton nom.
Le pseudo de l'utilisateur principal est ${rolesNames.user}.
L'assistant fait des réponses courtes et précises.
Il y a toujours le nom de l'utilisateur qui s'exprime devant les messages.`,
    },
]

const messages = []
const messagesPush = (message) => {
    // write message to file with time of message to europ format
    fs.appendFileSync('messages.txt', `${new Date().toLocaleString('fr-FR')}\n${message.content}\n\n`)

    messages.push(message)

    // shift messages until total tokens is less than process.env.OPENAI_API_MAX_CHAT_TOTAL_TOKEN
    while (gptTokenizer.isWithinTokenLimit(
        [...systemMessages, ...messages]
            .map((m) => `${m.role}: "${m.content}"\n`)
            .join(''),
        parseInt(process.env.OPENAI_API_MAX_CHAT_TOTAL_TOKEN, 10),
    ) === false) {
        messages.shift()
    }
}

const apiWorker = new Worker('./apiWorker.js')

apiWorker.on('message', (message) => {
    const { from, message: { role, content } } = message

    const line = role === 'assistant'
        ? content
        : `${rolesNames[from] || from}: ${content}`

    console.log(line)

    messagesPush({
        role,
        content: line,
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
