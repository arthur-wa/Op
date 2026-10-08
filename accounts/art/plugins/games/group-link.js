export default {
    NovaUltra: {
        command: "رابط",
        description: "يحول ID الجروب إلى رابط دعوة",
        elite: "on",
    },
    execute: async ({ sock, msg, args }) => {
        const chatId = msg.key.remoteJid;

        const groupId = args[0]?.trim();

        if (!groupId) {
            return await sock.sendMessage(chatId, {
                text: "❗ أرسل ID الجروب\nمثال: .رابط 120363404936733866@g.us"
            }, { quoted: msg });
        }

        // لو ما حط @g.us أضفها تلقائي
        const fullId = groupId.includes("@g.us") ? groupId : `${groupId}@g.us`;

        try {
            const code = await sock.groupInviteCode(fullId);
            const link = `https://chat.whatsapp.com/${code}`;

            await sock.sendMessage(chatId, {
                text: `🔗 رابط الجروب:\n\n${link}`
            }, { quoted: msg });

        } catch (err) {
            await sock.sendMessage(chatId, {
                text: `❌ فشل\n${err?.message}\n\nتأكد إن البوت مشرف في الجروب`
            }, { quoted: msg });
        }
    }
};
