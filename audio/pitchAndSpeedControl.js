const ffmpeg = require('fluent-ffmpeg')
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path

ffmpeg.setFfmpegPath(ffmpegPath)

module.exports = (inputFilePath, outputFilePath) => new Promise((resolve, reject) => {
    const speed = process.env.ASSISTANT_VOICE_SPEED
    // Adjust the speed factor (1.0 for normal speed)
    const pitch = process.env.ASSISTANT_VOICE_PITCH
    // Adjust the pitch factor (1.0 for normal pitch)

    // Create an FFmpeg command
    const command = ffmpeg()
    // Input file
    command.input(inputFilePath)
    // Apply audio filter options for speed and pitch
    command.audioFilters([
        { // change pitch
            filter: 'asetrate',
            options: `24000 * ${pitch}`,
        },
        { // correct speed
            filter: 'atempo',
            options: 1 / pitch,
        },
    ])
    command.audioFilters([
        { // change speed
            filter: 'atempo',
            options: speed,
        },
    ])
    // Output file
    command.output(outputFilePath)
    // Run the FFmpeg command
    command.on('end', () => {
        resolve()
    }).on('error', (err) => {
        reject(err)
    }).run()
})
