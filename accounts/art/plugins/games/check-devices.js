// ══════════════════════════════════════════════════════════════
//  check-devices.js — أمر "فحص_اجهزة": جلسة تفاعلية لاختيار قروب
//  يقوم بسحب كل قروبوات البوت، وتحديد قروب برقم لفحص كل أعضائه
//
//  ✅ إصلاح دقة: الكود الأصلي كان يحوّل أي معرّف بأرقامه إلى
//     `@s.whatsapp.net` — لو المعرّف `@lid` يطلع رقم واتساب غلط
//     ويجيب أجهزة شخص غلط. الآن يمرّ عبر utils/resolvePn
//  ✅ الجلسة مسجّلة في sock.activeListeners فما يتداخل مع
//     المُوزّع الرئيسي (ما تطلع أوامر كاذبة من الأرقام المكتوبة)
//  ✅ تكيّف تلقائي مع rate-limit: لو واتساب رجّعت خطأ نضاعف
//     الفاصل بدل ما نكرّر الطلب ونخسره
// ══════════════════════════════════════════════════════════════

import { identify, resolveFull, getLinkedDevices, senderDigits, digitsOf } from '../../utils/memberId.js';

const NovaUltra = {
    command:     ['فحص', 'فحص_اجهزة', 'فحص_قروب', 'كشف_قروب', 'checkdev'],
    description: 'فحص جميع أعضاء قروب معين وكشف الأجهزة المرتبطة لكل عضو عبر جلسة تفاعلية',
    elite:       'on',
    group:       false,
    prv:         false,
    lock:        'off',
};

const activeSessions = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ⚙️ ضبط السرعة
const CHUNK_SIZE   = 35;     // عدد الأرقام في طلب USync واحد
const CHUNK_DELAY  = 600;    // الفاصل بين الطلبات (كان 1200 — أسرع)
const MAX_DELAY    = 4000;   // سقف التهدئة عند rate-limit
const SESSION_TTL  = 120_000;

function clearSession(chatId, sock, sess) {
    const s = sess || activeSessions.get(chatId);
    if (!s) return;
    if (s.timeout) clearTimeout(s.timeout);
    if (s.listener) sock.ev.off('messages.upsert', s.listener);
    activeSessions.delete(chatId);
    // نحرّر المُوزّع الرئيسي
    try { sock.activeListeners?.delete(chatId); } catch {}
}

/**
 * يفحص أعضاء القروب — يشمل أصحاب اليوزرات (رقمهم مخفي) عبر @lid.
 * @returns {{rows: Array<{idn, devs:number}>, total:number, failed:number}}
 */
async function getCompanions(sock, groupId, participants, meta, onProgress) {
    // معرّف لكل عضو (بدون تكرار)
    const byKey = new Map();
    for (const p of participants) {
        const idn = identify(p);   // بيانات القروب فيها الرقم والـ lid → بلا طلبات شبكة
        if (idn.jid && !byKey.has(idn.key)) byKey.set(idn.key, idn);
    }
    const members = [...byKey.values()];

    const { map, failed } = await getLinkedDevices(
        sock, members.map(m => m.jid),
        { chunkSize: CHUNK_SIZE, delay: CHUNK_DELAY, maxDelay: MAX_DELAY, onProgress }
    );

    const rows = [];
    for (const idn of members) {
        const set = map.get(digitsOf(idn.jid));
        if (set && set.size) rows.push({ idn, devs: set.size });
    }
    rows.sort((a, b) => b.devs - a.devs);
    return { rows, total: members.length, failed };
}

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;
    const senderSet = senderDigits(sock, msg);

    if (activeSessions.has(chatId)) {
        return sock.sendMessage(chatId, {
            text: '⏳ _لديك جلسة فحص نشطة حالياً. اختر رقماً أو اكتب *الغاء*._'
        }, { quoted: msg });
    }

    await sock.sendMessage(chatId, { react: { text: '📋', key: msg.key } }).catch(() => {});

    let allGroups = {};
    try {
        allGroups = await sock.groupFetchAllParticipating();
    } catch (err) {
        return sock.sendMessage(chatId, { text: `❌ تعذر جلب قائمة المجموعات: ${err.message}` }, { quoted: msg });
    }

    const groupsList = Object.values(allGroups);
    if (!groupsList.length) {
        return sock.sendMessage(chatId, { text: '⚠️ _البوت ليس عضواً في أي قروب حالياً._' }, { quoted: msg });
    }

    let menu = `📦 *اختر القروب المراد فحص أجهزة أعضائه:*\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    groupsList.forEach((g, idx) => {
        menu += `*${idx + 1}.* ${g.subject || 'بدون اسم'} \`(👥 ${g.participants?.length || 0})\`\n`;
    });
    menu += `\n✍️ _أرسل رقم القروب (1-${groupsList.length}) للبدء، أو اكتب *الغاء*._`;

    await sock.sendMessage(chatId, { text: menu }, { quoted: msg });

    // ── نُخبر المُوزّع الرئيسي إن في جلسة تفاعلية ──
    let sessionRef = null;
    const cleanup = () => clearSession(chatId, sock, sessionRef);
    try {
        if (!sock.activeListeners) sock.activeListeners = new Map();
        sock.activeListeners.set(chatId, cleanup);
    } catch {}

    const timeout = setTimeout(() => {
        cleanup();
        sock.sendMessage(chatId, { text: '⏰ _انتهت مهلة اختيار القروب تلقائياً._' }).catch(() => {});
    }, SESSION_TTL);

    const listener = async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;

        const incoming = senderDigits(sock, m);
        if (senderSet.size && ![...incoming].some(d => senderSet.has(d))) return;

        const txt = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();
        if (!txt) return;

        const low = txt.toLowerCase();
        if (low === 'الغاء' || low === 'إلغاء' || low === 'stop' || low === 'cancel') {
            cleanup();
            return sock.sendMessage(chatId, { text: '✅ _تم إلغاء جلسة الفحص._' }, { quoted: m });
        }

        const selectedIndex = parseInt(txt, 10);
        if (isNaN(selectedIndex) || selectedIndex < 1 || selectedIndex > groupsList.length) {
            return sock.sendMessage(chatId, {
                text: `⚠️ _يرجى اختيار رقم صحيح من القائمة (1 إلى ${groupsList.length}) أو اكتب *الغاء*._`
            }, { quoted: m });
        }

        cleanup();
        const targetGroup = groupsList[selectedIndex - 1];

        const statusMsg = await sock.sendMessage(chatId, {
            text: `⏳ *جاري فحص أعضاء:* \`${targetGroup.subject}\`\n_الرجاء الانتظار قليلاً لتجنب حظر الخوادم..._`
        }, { quoted: m }).catch(() => null);

        try {
            const meta = await sock.groupMetadata(targetGroup.id).catch(() => targetGroup);
            const participants = meta.participants || [];

            const onProgress = async (done, total) => {
                if (statusMsg) {
                    await sock.sendMessage(chatId, {
                        text: `⏳ فحص: ${done}/${total}...`,
                        edit: statusMsg.key
                    }).catch(() => {});
                }
            };

            const { rows, total, failed } = await getCompanions(sock, targetGroup.id, participants, meta, onProgress);

            let report = `👥 *القروب:* ${meta.subject}\n🔌 *أجهزة مرتبطة:* ${rows.length}\n📋 *الأعضاء المفحوصين:* ${total}\n`;
            if (failed) report += `⚠️ *تعذّر فحص ${failed} عضو (ضغط واتساب) — أعد الفحص بعد دقيقة*\n`;
            report += `\n`;

            const mentions = [];
            if (rows.length === 0) {
                report += failed ? `⚠️ لم تظهر أجهزة (مع وجود أخطاء).` : `✅ لا توجد أي أجهزة مرتبطة.`;
            } else {
                rows.forEach(({ idn, devs }, i) => {
                    mentions.push(idn.jid);   // رقم أو @lid لأصحاب اليوزرات
                    report += `${i + 1}. 👤 @${idn.label} ➔ 🔌 *الأجهزة:* ${devs}\n`;
                });
            }

            await sock.sendMessage(chatId, { text: report, mentions }, { quoted: m });
        } catch (err) {
            console.error('[Batch Devices Error]:', err);
            await sock.sendMessage(chatId, { text: `❌ فشل فحص القروب: ${err.message}` }, { quoted: m });
        }
    };

    sessionRef = { listener, timeout };
    activeSessions.set(chatId, sessionRef);
    sock.ev.on('messages.upsert', listener);
}

export default { NovaUltra, execute };
