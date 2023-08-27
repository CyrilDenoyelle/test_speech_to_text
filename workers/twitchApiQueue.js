// twitch

const { parentPort } = require('worker_threads')
const { RefreshingAuthProvider } = require('@twurple/auth')
const { Bot } = require('@twurple/easy-bot')
const fs = require('node:fs/promises')

const authProvider = new RefreshingAuthProvider(
    {
        clientId: process.env.TWITCH_CLIENT_ID,
        clientSecret: process.env.TWITCH_CLIENT_SECRET,
    },
)

authProvider.onRefresh(async (userId, newTokenData) => {
    await fs.writeFile(`./tokens/tokens.${userId}.json`, JSON.stringify(newTokenData, null, 4), 'UTF-8')
});

(async () => {
    // read file sync
    const tokenData = JSON.parse(await fs.readFile(`./tokens/tokens.${process.env.ASSISTANT_TWITCH_USER_ID}.json`, (err, data) => data))

    await authProvider.addUserForToken(tokenData, ['chat'])

    const bot = new Bot({
        authProvider,
        channels: [process.env.PROMPT_USER_NAME],
    })

    bot.onMessage(async (messageEvent) => {
        parentPort.postMessage({
            role: 'user',
            content: `${messageEvent.userDisplayName}: ${messageEvent.text}`,
        })
    })

    const tasks = {
        sendMessageToChat: async (message) => {
            // send a message in the twitch chat with twurple
            await bot.say(process.env.PROMPT_USER_NAME, message)
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
})()
