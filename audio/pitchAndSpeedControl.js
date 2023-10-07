const ffmpeg = require('fluent-ffmpeg')
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path

ffmpeg.setFfmpegPath(ffmpegPath)

module.exports = (inputFilePath, outputFilePath, speed, pitch) => new Promise((resolve, reject) => {
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
