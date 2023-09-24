const { parentPort } = require('worker_threads')
const fs = require('fs')
const { OpenAI } = require('openai')
const twitchBotGen = require('./auth/twitchBot')

const openai = new OpenAI()

const openaiBaseSetings = {
    model: process.env.OPENAI_MODEL,
    max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS_BY_MESSAGE, 10),
    temperature: parseInt(process.env.OPENAI_TEMPERATURE, 10),
};

(async () => {
    const twitchBot = await twitchBotGen()

    twitchBot.onMessage(async (messageEvent) => {
        parentPort.postMessage({
            from: `twitchChat:${messageEvent.userDisplayName}`,
            message: {
                role: 'user',
                content: messageEvent.text,
            },
        })
    })

    const queue = []

    const tasks = {
        sendAudioToOpenAi: async (audioFilename) => {
            // transcribe audio to text
            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(audioFilename),
                model: 'whisper-1',
            })
            parentPort.postMessage({
                from: 'user',
                message: {
                    role: 'user',
                    content: transcription.text,
                },
            })
        },
        sendChatToOpenAi: async (messages) => {
            // ask openai for an answer
            const answer = await openai.chat.completions.create({
                messages,
                ...openaiBaseSetings,
            })

            parentPort.postMessage({
                from: 'assistant',
                message: {
                    role: 'assistant',
                    content: answer.choices[0].message.content,
                },
            })
        },
        sendMessageToChat: async (message) => {
            // send a message in the twitch chat with twurple
            await twitchBot.say(process.env.PROMPT_USER_NAME, message)
        },
    }

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
})()
