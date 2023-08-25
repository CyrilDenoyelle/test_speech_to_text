const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
const mic = require('mic')
const { Readable } = require('stream')

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path

const { OpenAI } = require('openai')

require('dotenv').config()

const openai = new OpenAI()

ffmpeg.setFfmpegPath(ffmpegPath)

const openaiBaseSetings = {
    model: 'gpt-3.5-turbo',
    max_tokens: 100,
    temperature: 0.6,
}

const userName = process.env.PROMPT_USER_NAME
const assistantName = process.env.PROMPT_ASSISTANT_NAME

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

        console.log('-rec-')
        const micInputStream = micInstance.getAudioStream()
        const output = fs.createWriteStream(filename)
        const writable = new Readable().wrap(micInputStream)

        writable.pipe(output)

        micInstance.start()

        micInputStream.on('silence', async () => {
            console.log(`-rec-stop-${recordTime}`)
            micInstance.stop()

            if (recordTime <= 5) {
                // too short, retry
                await recordAudio()
            }

            i += 1

            resolve(filename)
        })

        micInputStream.on('error', reject)
    })
}

const messages = [
    {
        role: 'system',
        content: `tu es ${assistantName}.
L'utilisateur s'appelle ${userName}.
L'utilisateur ne parle pas toujours a ${assistantName}.
Si ${assistantName} ne comprend pas il répond uniquement "----".
Si ${assistantName} ne peut pas apporter de réponse il répond uniquement "----".
Si l'utilisateur dit le nom de ${assistantName}, ${assistantName} l'assistant répond même si il n'as pas compris.`,
    },
]

// main function
async function main() {
    // record audio and resolve when it's usable
    const audioFilename = await recordAudio()
    // transcribe audio to text
    const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioFilename),
        model: 'whisper-1',
    })

    console.log(`${userName}: ${transcription.text}`)
    // add text to messages as user
    messages.push({
        role: 'user',
        content: transcription.text,
    })
    // if assistant name is in text, ask openai for an answer
    if (transcription.text.includes(`${assistantName}`)) {
        const answer = await openai.chat.completions.create({
            messages,
            ...openaiBaseSetings,
        })

        // add answer to messages as assistant
        console.log(`${assistantName}: ${answer.choices[0].message.content}`)
        messages.push({
            role: 'assistant',
            content: answer.choices[0].message.content,
        })
    }

    // restart
    await main()
}

console.log('Recording... Press Ctrl+C to stop.')
main()
