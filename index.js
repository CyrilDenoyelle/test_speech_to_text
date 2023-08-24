const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
const mic = require('mic')
const { Readable } = require('stream')

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path

const { OpenAI } = require('openai')

require('dotenv').config()

const openai = new OpenAI()

ffmpeg.setFfmpegPath(ffmpegPath)

// Record audio
function recordAudio(filename) {
    return new Promise((resolve, reject) => {
        const micInstance = mic({
            rate: '16000',
            channels: '1',
            fileType: 'wav',
            exitOnSilence: 5,
        })

        const micInputStream = micInstance.getAudioStream()
        const output = fs.createWriteStream(filename)
        const writable = new Readable().wrap(micInputStream)

        writable.pipe(output)

        micInstance.start()

        micInputStream.on('silence', () => {
            micInstance.stop()
            console.log('Finished recording by silence')
            resolve()
        })

        micInputStream.on('error', (err) => {
            reject(err)
        })
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

let i = 0
// main function
async function main() {
    const audioFilename = `recorded_audios/recorded_audio${i}.wav`
    await recordAudio(audioFilename)
    const transcription = await transcribeAudio(audioFilename)
    console.log(`Transcription recorded_audio${i += 1}:`, transcription)
    await main()
}

console.log('Recording... Press Ctrl+C to stop.')
main()
