// ══════════════════════════════════════════════════════════════
//  notify-route.js — أمر ".قروب" : جلسة تفاعلية لتسجيل القروبات
//
//  .قروب 1   ← يفتح جلسة للمجموعة 1 ويعرض قروبات البوت مرقّمة
//     داخل الجلسة:
//       1 4 7        ← يضيف القروبات (مسافة أو فاصلة، ويدعم 3-6)
//       حذف 4 7      ← يشيلها من المجموعة
//       عرض          ← يعرض اللي مسجّل الحين
//       انهاء        ← يقفل الجلسة
//  .قروب     ← ملخص كل المجموعات
// ══════════════════════════════════════════════════════════════

import {
    TARGETS, MAIN_JID, slotExists, getSlotOf,
    assignGroup, unassignGroup, groupsOfSlot,
} from '../../utils/notifyRouter.js';
import { senderDigits } from '../../utils/memberId.js';

const NovaUltra = {
    command:     ['قروب', 'notifygroup'],
    description: 'جلسة تفاعلية لتسجيل القروبات في مجموعة إشعارات مرقمة',
    elite:       'on',
    group:       false,
    prv:         false,
    lock:        'off',
};

const SESSION_TTL = 5 * 60_000;   // يتجدد مع كل رسالة منك
const MSG_LIMIT   = 3500;         // تقسيم القائمة الطويلة على رسائل

const END_WORDS    = ['انهاء', 'إنهاء', 'خلاص', 'تم', 'انتهى', 'done', 'end'];
const REMOVE_WORDS = ['حذف', 'ازالة', 'إزالة', 'شيل', 'remove'];
const SHOW_WORDS   = ['عرض', 'الحالة', 'show'];
const CANCEL_WORDS = ['الغاء', 'إلغاء', 'cancel', 'stop'];

const activeSessions = new Map();

const normDigits = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const toNum = s => { const t = normDigits(s); return /^\d+$/.test(t) ? parseInt(t, 10) : null; };
const textOf = m => (m?.message?.conversation || m?.message?.extendedTextMessage?.text || '').trim();

/** "1 4,7 9-11" → [1,4,7,9,10,11] */
function parseNumbers(tokens, max) {
    const out = new Set();
    let bad = 0;
    for (const raw of tokens) {
        const t = normDigits(raw);
        if (!t) continue;
        const range = t.match(/^(\d+)-(\d+)$/);
        if (range) {
            let [a, b] = [parseInt(range[1], 10), parseInt(range[2], 10)];
            if (a > b) [a, b] = [b, a];
            for (let i = a; i <= b; i++) (i >= 1 && i <= max) ? out.add(i) : bad++;
        } else if (/^\d+$/.test(t)) {
            const n = parseInt(t, 10);
            (n >= 1 && n <= max) ? out.add(n) : bad++;
        } else bad++;
    }
    return { nums: [...out], bad };
}

/** يقسّم نص طويل إلى رسائل بحجم مناسب */
function splitLines(lines, limit = MSG_LIMIT) {
    const parts = []; let cur = '';
    for (const l of lines) {
        if ((cur + l + '\n').length > limit && cur) { parts.push(cur); cur = ''; }
        cur += l + '\n';
    }
    if (cur) parts.push(cur);
    return parts;
}

function menuLines(groups, slot) {
    return groups.map((g, i) => {
        const cur = getSlotOf(g.id);
        const mark = cur === slot ? '  ✅' : (cur != null ? `  🔸${cur}` : '');
        return `*${i + 1}.* ${g.subject || 'بدون اسم'}${mark}`;
    });
}

function slotSummary(groups, slot) {
    const ids = new Set(groupsOfSlot(slot));
    const names = groups.filter(g => ids.has(g.id)).map(g => `  • ${g.subject || g.id}`);
    // قروبات مسجّلة لكن البوت ما عاد فيها
    const known = new Set(groups.map(g => g.id));
    for (const id of ids) if (!known.has(id)) names.push(`  • ${id}`);
    return names.length ? names.join('\n') : '  — ما فيه قروبات —';
}

function clearSession(chatId, sock) {
    const s = activeSessions.get(chatId);
    if (!s) return;
    if (s.timeout) clearTimeout(s.timeout);
    if (s.listener) sock.ev.off('messages.upsert', s.listener);
    activeSessions.delete(chatId);
    try { sock.activeListeners?.delete(chatId); } catch {}
}

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const reply  = (text, q = msg) => sock.sendMessage(chatId, { text }, { quoted: q });
    const slot   = toNum(args?.[0]);
    const slots  = Object.keys(TARGETS).join(' / ');

    // ── .قروب (بدون رقم) → ملخص ──
    if (slot === null) {
        let groups = [];
        try { groups = Object.values(await sock.groupFetchAllParticipating()); } catch {}
        const nameOf = id => groups.find(g => g.id === id)?.subject || id;

        const blocks = Object.keys(TARGETS).map(k => {
            const n = Number(k);
            return `${k}️⃣ ← ${nameOf(TARGETS[k])}\n${slotSummary(groups, n)}`;
        });
        return reply(
`📡 توزيع الإشعارات

${blocks.join('\n\n')}

📬 الأساسي (يستلم كل شي) : ${nameOf(MAIN_JID)}

📌 \`.قروب 1\` ← افتح جلسة وأضف قروبات للمجموعة 1`);
    }

    if (!slotExists(slot)) return reply(`⚠️ المجموعة ${slot} غير موجودة. المتاح: ${slots}`);

    if (activeSessions.has(chatId)) {
        return reply('⏳ _فيه جلسة شغالة هنا. أكملها أو اكتب *انهاء*._');
    }

    // ── نجيب القروبات (مرتبة بالاسم عشان الترقيم يكون ثابت) ──
    let groups;
    try {
        groups = Object.values(await sock.groupFetchAllParticipating())
            .sort((a, b) => (a.subject || '').localeCompare(b.subject || '', 'ar'));
    } catch (err) {
        return reply(`❌ تعذر جلب القروبات: ${err.message}`);
    }
    if (!groups.length) return reply('⚠️ _البوت مو عضو في أي قروب._');

    const senderSet = senderDigits(sock, msg);   // رقم + lid (أصحاب اليوزرات)

    // ── القائمة ──
    const head = `📦 *جلسة المجموعة ${slot}* ← ${groups.find(g => g.id === TARGETS[slot])?.subject || TARGETS[slot]}\n` +
                 `✅ = مسجّل هنا   🔸 = مسجّل بمجموعة ثانية\n━━━━━━━━━━━━━━━━━━━━━━`;
    const foot = `✍️ أرسل أرقام القروبات لإضافتها (مثال: \`1 4 7\` أو \`3-6\`)\n` +
                 `🗑️ \`حذف 4 7\` للإزالة  •  \`عرض\` للحالة  •  *انهاء* للإغلاق`;

    const parts = splitLines(menuLines(groups, slot));
    await sock.sendMessage(chatId, { text: `${head}\n\n${parts[0]}` }, { quoted: msg });
    for (let i = 1; i < parts.length; i++) await sock.sendMessage(chatId, { text: parts[i] });
    await sock.sendMessage(chatId, { text: foot });

    // ── الجلسة ──
    const cleanup = () => clearSession(chatId, sock);
    try {
        if (!sock.activeListeners) sock.activeListeners = new Map();
        sock.activeListeners.set(chatId, cleanup);
    } catch {}

    const sess = { listener: null, timeout: null };
    const arm = () => {
        clearTimeout(sess.timeout);
        sess.timeout = setTimeout(() => {
            cleanup();
            sock.sendMessage(chatId, { text: '⏰ _انتهت الجلسة تلقائياً (ما فيه نشاط)._' }).catch(() => {});
        }, SESSION_TTL);
    };

    sess.listener = async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;

        const incoming = senderDigits(sock, m);
        if (senderSet.size && ![...incoming].some(d => senderSet.has(d))) return;

        const txt = textOf(m);
        if (!txt) return;
        arm();

        const tokens = normDigits(txt).split(/[\s,،]+/).filter(Boolean);
        const first  = tokens[0]?.toLowerCase();

        // إنهاء
        if (END_WORDS.includes(first) || CANCEL_WORDS.includes(first)) {
            cleanup();
            return reply(
`✅ *انتهت الجلسة*

المجموعة ${slot} فيها الحين (${groupsOfSlot(slot).length}):
${slotSummary(groups, slot)}

إشعاراتها تنبعث لقروبها + الأساسي.`, m);
        }

        // عرض
        if (SHOW_WORDS.includes(first)) {
            return reply(`📋 *المجموعة ${slot}* (${groupsOfSlot(slot).length}):\n${slotSummary(groups, slot)}`, m);
        }

        // حذف
        if (REMOVE_WORDS.includes(first)) {
            const { nums, bad } = parseNumbers(tokens.slice(1), groups.length);
            if (!nums.length) return reply(`⚠️ اكتب أرقام صحيحة (1-${groups.length}) بعد كلمة حذف.`, m);

            const removed = [], skipped = [];
            for (const n of nums) {
                const g = groups[n - 1];
                if (getSlotOf(g.id) === slot) { unassignGroup(g.id); removed.push(g.subject || g.id); }
                else skipped.push(g.subject || g.id);
            }
            return reply(
`🗑️ *إزالة من المجموعة ${slot}*
${removed.length ? removed.map(x => `  • ${x}`).join('\n') : '  — لا شي —'}${
skipped.length ? `\n\nℹ️ مو مسجّلة أصلاً هنا: ${skipped.length}` : ''}${
bad ? `\n⚠️ أرقام غير صحيحة: ${bad}` : ''}

📊 الحين بالمجموعة: ${groupsOfSlot(slot).length}`, m);
        }

        // إضافة
        const { nums, bad } = parseNumbers(tokens, groups.length);
        if (!nums.length) {
            return reply(`⚠️ _اكتب أرقام صحيحة (1-${groups.length}) أو *انهاء*._`, m);
        }

        const added = [], already = [], moved = [];
        for (const n of nums) {
            const g = groups[n - 1];
            const name = g.subject || g.id;
            const cur = getSlotOf(g.id);
            if (cur === slot) { already.push(name); continue; }
            if (cur != null)  moved.push(`${name} (كان في ${cur})`);
            assignGroup(g.id, slot);
            added.push(name);
        }

        return reply(
`✅ *أُضيف للمجموعة ${slot}* (${added.length})
${added.length ? added.map(x => `  • ${x}`).join('\n') : '  — لا شي جديد —'}${
moved.length ? `\n\n🔄 انتقل من مجموعة ثانية:\n${moved.map(x => `  • ${x}`).join('\n')}` : ''}${
already.length ? `\n\nℹ️ كانت مسجّلة: ${already.length}` : ''}${
bad ? `\n⚠️ أرقام غير صحيحة: ${bad}` : ''}

📊 الحين بالمجموعة: ${groupsOfSlot(slot).length}
_كمّل أرقام ثانية أو اكتب *انهاء*_`, m);
    };

    activeSessions.set(chatId, sess);
    sock.ev.on('messages.upsert', sess.listener);
    arm();
}

export default { NovaUltra, execute };
