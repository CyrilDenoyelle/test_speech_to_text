const { parentPort } = require('worker_threads')
const fs = require('fs')
const { OpenAI } = require('openai')

const Gtts = require('gtts')

const gptTokenizer = require('gpt-tokenizer')

gptTokenizer.default.modelName = 'cl100k_base'

const twitchBotGen = require('./auth/twitchBot')
const customFunctions = require('./customFunctions')

const openai = new OpenAI()

const openaiBaseSetings = {
    model: process.env.OPENAI_CHAT_MODEL,
    max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS_BY_MESSAGE, 10),
    temperature: parseInt(process.env.OPENAI_TEMPERATURE, 10),
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
        content: `tu es l'assistant, tu te nommes ${process.env.PROMPT_ASSISTANT_NAME} et tu ne réponds qu'en ton nom.
Le pseudo de l'utilisateur principal est ${process.env.PROMPT_USER_NAME}.
L'assistant fait des réponses courtes et précises.
les pseudos des utilisateurs du chat twitch sont précédé de "(twitch chat) 'username':". 
${twitchChatUserString()}`,
    },
    {
        role: 'user',
        content: `Dit moi ${process.env.PROMPT_ASSISTANT_NAME} comment ça va ?`,
    },
    {
        role: 'assistant',
        content: `Salut ${process.env.PROMPT_USER_NAME}, ça va très bien, et vous ?`,
    },
    {
        role: 'user',
        content: `(twitch chat) Xx_dark_sasuke_xX: "Bonjour ${process.env.PROMPT_ASSISTANT_NAME} !"`,
    },
    {
        role: 'assistant',
        content: 'Salut Xx_dark_sasuke_xX, ça va super, et toi ?',
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
        f: () => {
            console.log('adding marker')
            return 'marker added'
        },
    },
    ...customFunctions,
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
            const { triggeredBy, from, message: { role, content, functionCall } } = message

            let line = ''

            if (functionCall) {
                if (functions[functionCall.name]) {
                    try {
                        const args = JSON.parse(functionCall.arguments)
                        const resultString = await functions[functionCall.name].f(args)
                        // write message to file with time of message to europ format
                        fs.appendFileSync('messages.txt', `${new Date().toLocaleString('fr-FR')}\n${triggeredBy} => functionCall: ${functionCall.name}(${functionCall.arguments})\n\n`)

                        await tasks.sendMessage({
                            from: 'system',
                            message: {
                                role: 'system',
                                content: `${process.env.PROMPT_ASSISTANT_NAME}, ${functionCall.name} = "${resultString}".`,
                            },
                        })
                    } catch (error) {
                        console.log('error', error)
                    }
                }
                return
            }

            if (from.includes('twitchChat')) {
                const twitchChatUsername = from.split(':')[1]
                if (!twitchChatUsers.includes(twitchChatUsername)) {
                    twitchChatUsers.push(twitchChatUsername)
                }

                line = `(twitch chat) ${twitchChatUsername} a dit: "${content.replace('"', '\'\'')}"`
            } else {
                line = content
            }

            const trimedContent = line.replace(`${process.env.PROMPT_ASSISTANT_NAME}: `, '')
            // write message to file with time of message to europ format
            fs.appendFileSync('messages.txt', `${new Date().toLocaleString('fr-FR')}\n${from}: ${trimedContent}\n\n`)

            messagesPush({
                role,
                content: trimedContent,
            })

            // if assistant name is in text, ask worker for an openai answer
            if (['user', 'system'].includes(role)
                && content.includes(`${process.env.PROMPT_ASSISTANT_NAME}`)) {
                await tasks.sendChatToOpenAi(from, [
                    ...systemMessages(),
                    ...messages.map((m) => ({
                        role: m.role,
                        content: m.content,
                    })),
                ])
            } else if (role === 'assistant') {
                if (triggeredBy.includes('twitchChat')) {
                    console.log('sending message to chat', `${process.env.PROMPT_ASSISTANT_NAME}: ${trimedContent}`)
                    await twitchBot.say(process.env.PROMPT_USER_NAME, [`${process.env.PROMPT_ASSISTANT_NAME}: ${trimedContent}`])
                } else {
                    await tasks.talkInDiscordVocal(trimedContent)
                }
            }
        },
        sendChatToOpenAi: async (triggeredBy, chat) => {
            const message = chat[chat.length - 1]

            let authorisedFunctions = []

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

            await tasks.sendMessage({
                triggeredBy,
                from: 'assistant',
                message: {
                    role: 'assistant',
                    content: answer.choices[0].message.content,
                    functionCall: answer.choices[0].message.function_call,
                },
            })
        },
        talkInDiscordVocal: async (text) => {
            const gtts = new Gtts(text, 'fr')
            const fileName = `./recorded_audios/${new Date().toISOString().replace(/:/g, '-')}-${Math.random().toString(36).substring(7)}.wav`

            gtts.save(fileName, (err) => {
                if (err) { throw new Error(err) }
                parentPort.postMessage({
                    fileName,
                    speed: process.env.ASSISTANT_VOICE_SPEED,
                    pitch: process.env.ASSISTANT_VOICE_PITCH,
                })
            })
        },
    }

    const depile = async () => {
        if (queue.length > 0) {
            const task = queue[0]
            queue.shift()

            try {
                await tasks[task.f](...task.args)
            } catch (error) {
                fs.appendFileSync('messages.txt', `${new Date().toLocaleString('fr-FR')}\nERROR:\n${error}\n\n`)
            }

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
