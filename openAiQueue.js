const fs = require('fs')
const { OpenAI } = require('openai')
const { parentPort } = require('worker_threads')

const openai = new OpenAI()

const openaiBaseSetings = {
    model: 'gpt-3.5-turbo',
    max_tokens: 150,
    temperature: 0.7,
}

const tasks = {
    sendAudioToOpenAi: async (audioFilename) => {
        // transcribe audio to text
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioFilename),
            model: 'whisper-1',
        })
        parentPort.postMessage({
            role: 'user',
            content: transcription.text,
        })

        // if assistant name is in text,
    },
    sendChatToOpenAi: async (messages) => {
        // ask openai for an answer
        const answer = await openai.chat.completions.create({
            messages,
            ...openaiBaseSetings,
        })

        parentPort.postMessage({
            role: 'assistant',
            content: answer.choices[0].message.content,
        })
    },
}

const queue = []

const depile = async () => {
    if (queue.length > 0) {
        const task = queue[0]
        queue.shift()

        await tasks[task.f](...task.args)

        depile()
    } else {
        setTimeout(() => {
            depile()
        }, 500)
    }
}

parentPort.on('message', (task) => {
    queue.push(task)
})

depile()
