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
            if (recordTime <= 5) {
                // too short, retry
                micInstance.stop()
                await recordAudio()
            }

            micInstance.stop()

            i += 1

            resolve(filename)
        })

        micInputStream.on('error', reject)
    })
}

// Transcribe audio
async function transcribeAudio(filename) {
    const transcript = await openai.audio.transcriptions.create({
        file: fs.createReadStream(filename),
        model: 'whisper-1',
    })

    return transcript.text
}

const messages = [
    {
        role: 'system',
        content: `tu es Henri.
L'utilisateur s'appelle Jean Luc.
L'utilisateur ne parle pas toujours a Henri.
Si Henri ne comprend pas il répond uniquement "----".
Si Henri ne peut pas apporter de réponse il répond uniquement "----"`,
    },
]

async function complete() {
    const completion = await openai.chat.completions.create({
        messages,
        ...openaiBaseSetings,
    })

    return completion
}

// main function
async function main() {
    const audioFilename = await recordAudio()
    const transcription = await transcribeAudio(audioFilename)
    console.log(`Jean luc: ${transcription}`)
    messages.push({
        role: 'user',
        content: transcription,
    })

    if (transcription.includes('Henri')) {
        const answer = await complete(transcription)

        console.log(`Henri: ${answer.choices[0].message.content}`)
        messages.push({
            role: 'assistant',
            content: answer.choices[0].message.content,
        })
    }

    await main()
}

console.log('Recording... Press Ctrl+C to stop.')
main()
