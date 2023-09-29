const { parentPort } = require('worker_threads')
const fs = require('fs')
const { OpenAI } = require('openai')
const gptTokenizer = require('gpt-tokenizer')

gptTokenizer.default.modelName = 'cl100k_base'

const twitchBotGen = require('./auth/twitchBot')

const openai = new OpenAI()

const openaiBaseSetings = {
    model: process.env.OPENAI_CHAT_MODEL,
    max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS_BY_MESSAGE, 10),
    temperature: parseInt(process.env.OPENAI_TEMPERATURE, 10),
}

const rolesNames = {
    user: process.env.PROMPT_USER_NAME,
    assistant: process.env.PROMPT_ASSISTANT_NAME,
}

const twitchChatUsers = []
const twitchChatUserString = async () => {
    if (twitchChatUsers.length === 0) return ''
    if (twitchChatUsers.length === 1) return `L'utilisateur: ${twitchChatUsers[0]} est dans le chat twitch.`
    return `Les utilisateurs: ${twitchChatUsers.slice(0, -1).join(', ')} et ${twitchChatUsers.slice(-1)} sont dans le chat twitch.`
}

const systemMessages = () => [
    {
        role: 'system',
        content: `tu es l'assistant, tu te nommes ${rolesNames.assistant} et tu ne réponds qu'en ton nom.
Le pseudo de l'utilisateur principal est ${rolesNames.user}.
L'assistant fait des réponses courtes et précises.
Il y a toujours le nom de l'utilisateur qui s'exprime devant les messages.
${twitchChatUserString()}`,
    },
    {
        role: 'user',
        content: `Dit moi ${rolesNames.assistant} comment ça va ?`,
    },
    {
        role: 'assistant',
        content: `${rolesNames.assistant}: Salut ${rolesNames.user}, ça va très bien, et vous ?`,
    },
    {
        role: 'user',
        content: `(twitch chat) Xx_dark_sasuke_xX: "Bonjour ${rolesNames.assistant} !"`,
    },
    {
        role: 'assistant',
        content: `${rolesNames.assistant}: Salut Xx_dark_sasuke_xX, ça va super, et toi ?`,
    },
]

const messages = []
const messagesPush = (message) => {
    messages.push(message)

    // shift messages until total tokens is less than process.env.OPENAI_API_MAX_CHAT_TOTAL_TOKEN
    while (gptTokenizer.isWithinTokenLimit(
        [...systemMessages(), ...messages]
            .map((m) => `${m.role}: "${m.content}"\n`)
            .join(''),
        parseInt(process.env.OPENAI_API_MAX_CHAT_TOTAL_TOKEN, 10),
    ) === false) {
        messages.shift()
    }
}

const functions = {
    addMarker: {
        canRun: ['user'],
        name: 'addMarker',
        description: 'ajoute un marqueur',
        parameters: {
            type: 'object',
            properties: {},
        },
        f: () => console.log('adding marker'),
    },
};

(async () => {
    const twitchBot = await twitchBotGen()

    const queue = []

    twitchBot.onMessage(async (messageEvent) => {
        queue.push({
            f: 'sendMessage',
            args: [{
                from: `twitchChat:${messageEvent.userDisplayName}`,
                message: {
                    role: 'user',
                    content: messageEvent.text,
                },
            }],
        })
    })

    const tasks = {
        sendAudioToOpenAi: async (audioFilename) => {
            // transcribe audio to text
            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(audioFilename),
                model: process.env.OPENAI_STT_MODEL,
            })
            const message = {
                role: 'user',
                content: transcription.text,
            }
            messagesPush(message)

            await tasks.sendMessage({
                from: 'user',
                message,
            })
        },
        sendMessage: async (message) => {
            const { from, message: { role, content, functionCall } } = message

            let line = ''

            if (functionCall) {
                if (functions[functionCall.name]) {
                    functions[functionCall.name].f(functionCall.args)
                    // write message to file with time of message to europ format
                    fs.appendFileSync('messages.txt', `${new Date().toLocaleString('fr-FR')}\nfunctionCall: ${functionCall.name}\n\n`)
                }
                return
            }

            if (from.includes('twitchChat')) {
                const twitchChatUsername = from.split(':')[1]
                if (!twitchChatUsers.includes(twitchChatUsername)) {
                    twitchChatUsers.push(twitchChatUsername)
                }

                line = `(twitch chat) ${twitchChatUsername}: "${content.replace('"', '\'\'')}"`
            } else {
                line = `${rolesNames[from] || from}: ${content}`
            }

            console.log(line)

            // write message to file with time of message to europ format
            fs.appendFileSync('messages.txt', `${new Date().toLocaleString('fr-FR')}\n${line}\n\n`)

            messagesPush({
                role,
                content: line,
            })

            // if assistant name is in text, ask worker for an openai answer
            if (role === 'user' && content.includes(`${rolesNames.assistant}`)) {
                await tasks.sendChatToOpenAi([
                    ...systemMessages(),
                    ...messages.map((m) => ({
                        role: m.role,
                        content: m.content,
                    })),
                ])
            } else if (role === 'assistant') {
                await tasks.sendMessageToChat([content])
            }
        },
        sendChatToOpenAi: async (chat) => {
            const message = chat[chat.length - 1]

            let authorisedFunctions = null

            // filter functions by role in the processed message
            if (message.content.includes('(twitch chat)')) {
                authorisedFunctions = Object.entries(functions)
                    .filter(([, value]) => value.canRun.includes('twitch chat'))
            } else if (message.role === 'user') {
                authorisedFunctions = Object.entries(functions)
                    .filter(([, value]) => value.canRun.includes('user'))
            } else if (message.role === 'assistant') {
                authorisedFunctions = Object.entries(functions)
                    .filter(([, value]) => value.canRun.includes('assistant'))
            }

            const options = {
                messages: chat,
                ...openaiBaseSetings,
            }

            if (authorisedFunctions.length > 0) {
                options.functions = authorisedFunctions.map(([, value]) => ({
                    name: value.name,
                    description: value.description,
                    parameters: value.parameters,
                }))
            }

            // ask openai for an answer
            const answer = await openai.chat.completions.create(options)

            tasks.sendMessage({
                from: 'assistant',
                message: {
                    role: 'assistant',
                    content: answer.choices[0].message.content,
                    functionCall: answer.choices[0].message.function_call,
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
