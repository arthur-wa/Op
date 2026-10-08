export default {
    NovaUltra: {
        command: 'jid',
        description: 'يجيب JID القروب الحالي',
        elite: 'on', group: true, prv: false, lock: 'off'
    },

    execute: async ({ sock, msg }) => {
        const chatId = msg.key.remoteJid;
        await sock.sendMessage(chatId, {
            text: `\`\`\`${chatId}\`\`\``
        }, { quoted: msg });
    }
};
