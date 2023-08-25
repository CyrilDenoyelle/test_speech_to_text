const fs = require('fs')
const { OpenAI } = require('openai')
const { parentPort } = require('worker_threads')

const openai = new OpenAI()

const userName = process.env.PROMPT_USER_NAME
const assistantName = process.env.PROMPT_ASSISTANT_NAME

const openaiBaseSetings = {
    model: 'gpt-3.5-turbo',
    max_tokens: 100,
    temperature: 0.6,
}

const messages = [
    {
        role: 'system',
        content: `tu es l'assistant et tu te nommes ${assistantName}.
L'utilisateur s'appelle ${userName}.`,
    },
]

async function sendAudioToOpenAi(audioFilename) {
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
}

const queue = []

const depile = async () => {
    if (queue.length > 0) {
        const audioFilename = queue[0]
        queue.shift()
        await sendAudioToOpenAi(audioFilename)
        depile()
    } else {
        setTimeout(() => {
            depile()
        }, 500)
    }
}

parentPort.on('message', async (audioFilename) => {
    queue.push(audioFilename)
})

depile()
