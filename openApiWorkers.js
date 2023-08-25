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
        content: `tu es ${assistantName}.
L'utilisateur s'appelle ${userName}.
L'utilisateur ne parle pas toujours a ${assistantName}.
Si ${assistantName} ne comprend pas il répond uniquement "----".
Si ${assistantName} ne peut pas apporter de réponse il répond uniquement "----".
Si l'utilisateur dit le nom de ${assistantName}, ${assistantName} l'assistant répond même si il n'as pas compris.`,
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
        console.log(messages)
    }
}

parentPort.on('message', async (audioFilename) => {
    await sendAudioToOpenAi(audioFilename)
})
