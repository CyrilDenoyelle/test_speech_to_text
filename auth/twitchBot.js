const { RefreshingAuthProvider } = require('@twurple/auth')
const { Bot } = require('@twurple/easy-bot')
const fs = require('node:fs/promises')

const authProvider = new RefreshingAuthProvider(
    {
        clientId: process.env.TWITCH_CLIENT_ID,
        clientSecret: process.env.TWITCH_CLIENT_SECRET,
    },
)

const twitchBotGen = async () => {
    authProvider.onRefresh(async (userId, newTokenData) => {
        await fs.writeFile(`./tokens/tokens.${userId}.json`, JSON.stringify(newTokenData, null, 4), 'UTF-8')
    })

    const tokenData = JSON.parse(await fs.readFile(`./tokens/tokens.${process.env.ASSISTANT_TWITCH_USER_ID}.json`, (err, data) => data))

    await authProvider.addUserForToken(tokenData, ['chat'])

    const bot = new Bot({
        authProvider,
        channels: [process.env.PROMPT_USER_NAME],
    })

    return bot
}

module.exports = twitchBotGen
