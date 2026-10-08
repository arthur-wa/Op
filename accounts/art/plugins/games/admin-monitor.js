// ══════════════════════════════════════════════════════════════
//  admin-monitor.js — مراقب صلاحيات المشرفين + إشعار طرد البوت
//  ✅ الإصلاح الأساسي: المنشن كان يبني @lid ما يتفعل — صار يحوّل
//     للرقم الحقيقي عبر utils/resolvePn قبل بناء mentions
//  ✅ يعتمد على authorPn اللي يوفّره حدث group-participants.update
//     بدل ما يخمّن من الميتاداتا (سبب عدم الدقة سابقاً)
//  ✅ المنشن بالرقم، وأصحاب اليوزرات (رقمهم مخفي) بـ @lid الأصلي
//  ✅ جديد: لما البوت يطرد أحد → إشعار بنفس الزخرفة
//     لكن بدون رابط القروب، اسم القروب فقط
//  ✅ تجاهل الطرد اللي أعلنه بلوجن آخر (anti-contact) لمنع التكرار
// ══════════════════════════════════════════════════════════════

import chalk from 'chalk';
import { invalidateGroup } from '../../utils/resolvePn.js';
import { resolveFull, isBotId, digitsOf } from '../../utils/memberId.js';
import { decoFooter } from '../../utils/deco.js';
import { wasNoticed } from '../../utils/noticeMark.js';
import { NOTIFY_JID } from '../../utils/notifyJid.js';
import { sendNotify } from '../../utils/notifyRouter.js';

if (!global.groupEvHandlers) global.groupEvHandlers = [];

const HANDLER_ID = "__adminMonitor__";

if (!global[HANDLER_ID]) {
    global[HANDLER_ID] = true;

    global.groupEvHandlers.push(async (sock, update) => {
        try {
            const { participants, action, author, authorPn, id: groupId } = update;

            if (action !== "promote" && action !== "demote" && action !== "remove") {
                return;
            }

            // ── المنفّذ: authorPn (رقم) + author (قد يكون lid) نجمعهم ──
            const actorIdn = await resolveFull(sock, groupId, [authorPn, author].filter(Boolean));
            const actorIsBot = !!actorIdn.jid && isBotId(sock, actorIdn);
            // الطرد: نهتمّ فيه فقط لو فاعله البوت
            if (action === "remove" && !actorIsBot) return;

            // تغيّر إشراف → نحدّث الكاش عشان فحص الأدمن في
            // anti-contact يظل دقيق (ما نطرد أحدث مشرف بالغلط)
            if (action === "promote" || action === "demote") invalidateGroup(groupId);

            const isPromote = action === "promote";
            const isKick    = action === "remove";

            // ── اسم القروب + الرابط ──
            let groupName = groupId;
            let groupLink = null;

            try {
                const metadata = await sock.groupMetadata(groupId);
                groupName = metadata.subject || groupId;

                let inviteCode = null;
                try {
                    inviteCode = await sock.groupInviteCode(groupId);
                } catch {
                    try {
                        const info = await sock.groupInviteInfo(groupId);
                        inviteCode = info?.inviteCode || null;
                    } catch {}
                }
                if (inviteCode) groupLink = `https://chat.whatsapp.com/${inviteCode}`;
            } catch {}

            const authorNum = actorIdn.label || "غير معروف";

            const emoji = isKick ? "🚫" : (isPromote ? "⬆️" : "⬇️");
            const label = isKick ? "طرد عضو"
                        : (isPromote ? "ترقية مشرف" : "إزالة إشراف");
            const actionText = isKick ? "تم طرده من القروب"
                             : (isPromote ? "تمت ترقيته مشرفاً" : "تم سحب إشرافه");

            for (const target of participants) {
                // رقم أو @lid (أصحاب اليوزرات) — لا نرمي أحداً
                const tIdn = await resolveFull(sock, groupId, target);
                if (!tIdn.jid) continue;

                // بلوجن آخر أعلنه بالفعل → نتجاهل (نفحص كل أرقام العضو)
                if (isKick && tIdn.digits.some(d => wasNoticed(groupId, d))) continue;

                const targetNum = tIdn.label;

                // المنشن: الرقم إن توفّر وإلا @lid الأصلي (وهو اللي يفعّل منشن صاحب اليوزر)
                const mentions = [...new Set([
                    tIdn.jid,
                    ...(actorIsBot ? [] : [actorIdn.jid]),
                ].filter(Boolean))];

                const header = `${emoji} ${label}

🏷️ الجروب  : ${groupName}
👤 العضو   : @${targetNum}  ← ${actionText}
🧩 المنفّذ  : ${actorIsBot ? "البوت 🤖" : "@" + authorNum}
🕐 الوقت   : ${new Date().toLocaleString('ar-DZ', { hour12: false })}`;

                // الفرق المطلوب: الطرد بدون رابط — اسم القروب فقط
                const footer = isKick
                    ? decoFooter({ groupName })
                    : decoFooter({ groupLink, groupName });

                console.log(chalk.green(`[ADMIN MONITOR] ${action} mentions=${JSON.stringify(mentions)}`));

                await sendNotify(sock, groupId, {
                    text: `${header}\n\n${footer}`,
                    mentions
                });
            }

        } catch (err) {
            console.error(chalk.red("[ADMIN MONITOR ERROR]"), err?.message, err?.stack);
        }
    });

    console.log(chalk.green("✅ [ADMIN MONITOR] registered successfully"));
}

export default {
    NovaUltra: {
        command: ["مراقب", "مراقبة", "monitor"],
        description: "يعرض حالة مراقبة صلاحيات المشرفين",
        elite: "on",
    },
    execute: async ({ sock, msg }) => {
        const chatId = msg.key.remoteJid;
        const count  = global.groupEvHandlers?.length ?? 0;
        await sock.sendMessage(chatId, {
            text:
`📡 مراقب الصلاحيات

✅ ترقية المشرفين : مفعّل
✅ إزالة المشرفين : مفعّل
✅ طرد البوت      : مفعّل (بدون رابط — اسم القروب فقط)
🧩 معالجات مسجّلة : ${count}
🔔 الإشعارات تذهب لـ : ${NOTIFY_JID}`,
        }, { quoted: msg });
    },
};
